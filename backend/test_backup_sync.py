from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backup_sync import analyze, apply_merge


def make_followup(path: Path, control=None, supplier=None, history=None):
    con=sqlite3.connect(path)
    try:
        con.executescript("""
        CREATE TABLE order_controls(oc TEXT NOT NULL,supplier_key TEXT NOT NULL,control_status TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',sent_at TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(oc,supplier_key));
        CREATE TABLE suppliers(supplier_key TEXT PRIMARY KEY,display_name TEXT NOT NULL,phone TEXT DEFAULT '',contact_name TEXT DEFAULT '',active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
        CREATE TABLE order_control_history(id INTEGER PRIMARY KEY AUTOINCREMENT,oc TEXT NOT NULL,supplier_key TEXT NOT NULL,control_status TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',changed_at TEXT NOT NULL);
        """)
        if control: con.execute("INSERT INTO order_controls VALUES(?,?,?,?,?,?)",control)
        if supplier: con.execute("INSERT INTO suppliers VALUES(?,?,?,?,?,?)",supplier)
        for h in history or []: con.execute("INSERT INTO order_control_history(oc,supplier_key,control_status,note,changed_at) VALUES(?,?,?,?,?)",h)
        con.commit()
    finally: con.close()


def make_compras(path: Path, maps=None, messages=None):
    con=sqlite3.connect(path)
    try:
        con.executescript("CREATE TABLE items(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE maps(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE messages(id TEXT PRIMARY KEY,data TEXT NOT NULL);")
        for k,v in (maps or {}).items(): con.execute("INSERT INTO maps VALUES(?,?)",(k,json.dumps(v)))
        for k,v in (messages or {}).items(): con.execute("INSERT INTO messages VALUES(?,?)",(k,json.dumps(v)))
        con.commit()
    finally: con.close()


class BackupMergeTests(unittest.TestCase):
    def test_local_new_note_is_preserved_when_remote_is_blank(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(l,("100","sup","Pedido enviado","Nova informação local",None,"2026-09-29T18:00:00"))
            make_followup(r,("100","sup","Pedido enviado","",None,"2026-09-29T08:00:00"))
            report=analyze("followup",l,r,None,None)
            self.assertEqual(report["conflict_count"],0)
            apply_merge("followup",l,r,o,None,None,{})
            con=sqlite3.connect(o);row=con.execute("SELECT note FROM order_controls").fetchone();con.close()
            self.assertEqual(row[0],"Nova informação local")

    def test_remote_only_control_is_added_without_erasing_local(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(l,("100","a","Pendente","Local",None,"2026-09-29T10:00:00"))
            make_followup(r,("200","b","Enviado","Remoto",None,"2026-09-29T11:00:00"))
            report=analyze("followup",l,r,None,None)
            self.assertEqual(report["additions"],1)
            apply_merge("followup",l,r,o,None,None,{})
            con=sqlite3.connect(o);rows=con.execute("SELECT oc,note FROM order_controls ORDER BY oc").fetchall();con.close()
            self.assertEqual(rows,[("100","Local"),("200","Remoto")])

    def test_remote_imported_base_remains_authoritative_while_local_controls_survive(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(l,("100","a","Enviado","Trabalho local",None,"2026-09-29T12:00:00"))
            make_followup(r,("200","b","Pendente","Trabalho remoto",None,"2026-09-29T11:00:00"))
            for path,label in ((l,"BASE ANTIGA"),(r,"BASE NOVA")):
                con=sqlite3.connect(path)
                con.execute("CREATE TABLE orders(item_key TEXT PRIMARY KEY,description TEXT,imported_at TEXT)")
                con.execute("INSERT INTO orders VALUES(?,?,?)",("item-1",label,"2026-09-29T10:00:00"))
                con.commit();con.close()
            apply_merge("followup",l,r,o,None,None,{})
            con=sqlite3.connect(o)
            base=con.execute("SELECT description FROM orders WHERE item_key='item-1'").fetchone()[0]
            controls=con.execute("SELECT oc,note FROM order_controls ORDER BY oc").fetchall()
            con.close()
            self.assertEqual(base,"BASE NOVA")
            self.assertEqual(controls,[("100","Trabalho local"),("200","Trabalho remoto")])

    def test_same_field_divergence_requires_explicit_resolution(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(l,("100","a","Pendente","Local",None,"2026-09-29T10:00:00"))
            make_followup(r,("100","a","Pendente","Remoto",None,"2026-09-29T11:00:00"))
            report=analyze("followup",l,r,None,None)
            self.assertEqual(report["conflict_count"],1)
            cid=report["conflicts"][0]["id"]
            with self.assertRaises(ValueError): apply_merge("followup",l,r,o,None,None,{})
            apply_merge("followup",l,r,o,None,None,{cid:"remote"})
            con=sqlite3.connect(o);note=con.execute("SELECT note FROM order_controls").fetchone()[0];con.close()
            self.assertEqual(note,"Remoto")

    def test_three_way_merge_combines_independent_changes(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);b=td/"b.db";l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(b,("100","a","Pendente","Base",None,"2026-09-29T08:00:00"))
            make_followup(l,("100","a","Enviado","Base",None,"2026-09-29T09:00:00"))
            make_followup(r,("100","a","Pendente","Remoto",None,"2026-09-29T10:00:00"))
            report=analyze("followup",l,r,b,None)
            self.assertEqual(report["conflict_count"],0)
            apply_merge("followup",l,r,o,b,None,{})
            con=sqlite3.connect(o);row=con.execute("SELECT control_status,note FROM order_controls").fetchone();con.close()
            self.assertEqual(row,("Enviado","Remoto"))

    def test_history_is_unioned_without_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_followup(l,history=[("100","a","Pendente","A","2026-09-29T08:00:00")])
            make_followup(r,history=[("100","a","Pendente","A","2026-09-29T08:00:00"),("100","a","Enviado","B","2026-09-29T09:00:00")])
            apply_merge("followup",l,r,o,None,None,{})
            con=sqlite3.connect(o);count=con.execute("SELECT COUNT(*) FROM order_control_history").fetchone()[0];con.close()
            self.assertEqual(count,2)

    def test_maps_recursive_merge_and_duplicate_name_detection(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);b=td/"b.db";l=td/"l.db";r=td/"r.db";o=td/"o.db"
            make_compras(b,{"m1":{"name":"Mapa A","status":"open","note":"base","items":[{"id":"i1","price":10}]}})
            make_compras(l,{"m1":{"name":"Mapa A","status":"closed","note":"base","items":[{"id":"i1","price":10}]}})
            make_compras(r,{"m1":{"name":"Mapa A","status":"open","note":"remote","items":[{"id":"i1","price":10}]},"m2":{"name":"Mapa A","status":"open"}})
            report=analyze("compras",l,r,b,None)
            kinds={c["kind"] for c in report["conflicts"]}
            self.assertIn("potential_duplicate",kinds)
            dup=[c for c in report["conflicts"] if c["kind"]=="potential_duplicate"][0]
            apply_merge("compras",l,r,o,b,None,{dup["id"]:"local"})
            con=sqlite3.connect(o);data=json.loads(con.execute("SELECT data FROM maps WHERE id='m1'").fetchone()[0]);count=con.execute("SELECT COUNT(*) FROM maps").fetchone()[0];con.close()
            self.assertEqual(data["status"],"closed")
            self.assertEqual(data["note"],"remote")
            self.assertEqual(count,1)


if __name__=="__main__":
    unittest.main()
