"""Regression tests for order lookup by SCI in Acompanhamento."""
import tempfile
import unittest
from pathlib import Path

from engine import FollowUpService, Store


class FollowupSciSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name) / "followup.db")
        self.addCleanup(self.store.connection.close)
        with self.store.lock:
            self.store.connection.executemany(
                """INSERT INTO orders(
                    item_key,oc,company,sci,description,buyer,supplier_key,supplier_name,
                    quantity,value_total,order_status_code,imported_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    ("item-a", "100", "Hotel A", "777", "Parafuso", "Ana", "SUP", "Fornecedor", 2, 20, 0, "2026-10-07T09:00:00"),
                    ("item-b", "101", "Hotel A", "777", "Filtro", "Ana", "SUP", "Fornecedor", 1, 30, 0, "2026-10-07T09:00:00"),
                    ("item-c", "102", "Hotel A", "7770", "Sabonete", "Ana", "SUP", "Fornecedor", 1, 10, 0, "2026-10-07T09:00:00"),
                ],
            )
            self.store.connection.commit()
        self.service = FollowUpService(self.store)

    def test_exact_sci_returns_every_order_generated_from_that_sci(self):
        rows = self.service.order_summaries(search="777")
        self.assertEqual({row["oc"] for row in rows}, {"100", "101"})
        self.assertNotIn("102", {row["oc"] for row in rows})

    def test_existing_search_modes_remain_unchanged(self):
        self.assertEqual([row["oc"] for row in self.service.order_summaries(search="100")], ["100"])
        self.assertEqual([row["oc"] for row in self.service.order_summaries(search="parafuso")], ["100"])

    def test_order_detail_keeps_sci_on_each_item(self):
        detail = self.service.order_detail("100", "SUP")
        self.assertEqual(detail["items"][0]["sci"], "777")


if __name__ == "__main__":
    unittest.main()
