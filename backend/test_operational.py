import tempfile
import unittest
from pathlib import Path
from engine import Store, WorkbookImporter, FollowUpService, approval_summary, next_action
from openpyxl import Workbook
from datetime import date, timedelta


class OperationalTests(unittest.TestCase):
    def test_import_edit_reimport_and_custom_control(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'test.db')
            path = Path(root) / 'orders.xlsx'
            book = Workbook()
            book.active.append(['OC','EMPRESA','RAZAOSOCIALFORNECEDOR','DATAPREVISTAENTREGAOC','STATUSBPMOC','NMSTATUSBPMOC','DESCRICAOARTIGO'])
            book.active.append([12,'Hotel','Fornecedor',date.today()-timedelta(days=20),'3 - Aprovado',3,'Item de teste'])
            book.save(path)
            importer = WorkbookImporter(store)
            importer.import_file(str(path))
            service = FollowUpService(store)
            row = service.order_summaries()[0]
            self.assertEqual(row['approval_label'], 'Aprovada')
            self.assertEqual(row['next_action'], 'Fornecedor ainda não atualizado')
            presets = store.settings()['control_presets']
            presets.append(dict(id='custom_card', label='Financeiro', color='#123456', rule='card_payment', active=True))
            store.save_settings({'control_presets':presets})
            store.save_order_control(dict(oc=row['oc'],supplier_key=row['supplier_key'],control_status='custom_card',note='Observação'))
            presets[-1].update(label='Pagamento pendente',active=False)
            store.save_settings({'control_presets':presets})
            importer.import_file(str(path))
            row = service.order_summaries()[0]
            self.assertEqual(row['control_label'],'Pagamento pendente')
            self.assertEqual(row['control_color'],'#123456')
            self.assertEqual(row['control_note'],'Observação')
            self.assertEqual(row['next_action'],'Acompanhar pagamento no cartão')
            store.connection.close()

    def test_approval(self):
        for item, expected in [
            ({'order_bpm_status_code': 3}, 'approved'),
            ({'order_bpm_status_code': 4}, 'rejected'),
            ({'order_bpm_status': 'Aguardando aprovação'}, 'waiting'),
            ({'order_bpm_status': 'Não aprovado'}, 'waiting'),
            ({'order_bpm_status': 'Recusada'}, 'rejected'),
            ({}, 'unknown'),
        ]:
            self.assertEqual(approval_summary([item])[0], expected)
        self.assertEqual(approval_summary([{'order_bpm_status_code': 3}, {}])[0], 'unknown')

    def test_action_rules(self):
        row = dict(attendance_status='pending', approval_status='approved', urgency='overdue', control_status='', control_note='', due_date='2026-09-01')
        self.assertEqual(next_action(row, 'none')[0], 'Fornecedor ainda não atualizado')
        self.assertEqual(next_action(row, 'sent')[0], 'Cobrar confirmação de entrega')
        self.assertEqual(next_action(row, 'card_payment')[0], 'Acompanhar pagamento no cartão')
        self.assertEqual(next_action(row, 'cancel_requested')[1], 'urgent')
        for attendance in ('attended', 'canceled'):
            self.assertEqual(next_action({**row, 'attendance_status': attendance}, 'cancel_requested')[1], 'neutral')
        self.assertEqual(next_action({**row, 'approval_status': 'waiting'}, 'none')[0], 'Acompanhar aprovação da OC')
        self.assertEqual(next_action({**row, 'approval_status': 'rejected'}, 'none')[0], 'Revisar motivo da recusa')
        self.assertNotEqual(next_action({**row, 'control_note': 'Contato feito'}, 'none')[0], 'Fornecedor ainda não atualizado')

    def test_presets_persist_and_validate(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'test.db'
            store = Store(path)
            presets = store.settings()['control_presets']
            presets[0].update(label='Enviado ao fornecedor', color='#005577', active=False)
            presets.append(dict(id='custom_test', label='Novo controle', color='#007D9C', rule='none', active=True))
            store.save_settings({'control_presets': presets})
            store.connection.close()
            store = Store(path)
            self.assertEqual(store.settings()['control_presets'], presets)
            for invalid in [[{**presets[0], 'color': 'red;bad'}], [presets[0], presets[0]], [{**presets[0], 'label': ''}]]:
                with self.assertRaises(ValueError):
                    store.save_settings({'control_presets': invalid})
            self.assertEqual(store.settings()['control_presets'], presets)
            store.connection.close()

    def test_request_collection_is_available_for_existing_settings(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'test.db'
            store = Store(path)
            old_presets = [p for p in store.settings()['control_presets'] if p['id'] not in {'request_collection', 'awaiting_collection'}]
            store.save_settings({'control_presets': old_presets})
            store.connection.close()

            store = Store(path)
            collection = next(p for p in store.settings()['control_presets'] if p['id'] == 'request_collection')
            self.assertEqual(collection['label'], 'Solicitar coleta')
            self.assertEqual(collection['color'], '#C79A20')
            awaiting = next(p for p in store.settings()['control_presets'] if p['id'] == 'awaiting_collection')
            self.assertEqual(awaiting['label'], 'Aguardando ser coletado')
            store.connection.close()
