"""Deterministic state tests with a simulated museum response."""
import json
from pathlib import Path
import runpy
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class TreeMap(dict):
    @classmethod
    def __class_getitem__(cls, _):
        return cls


class UserError(Exception):
    pass


class BatchTest(unittest.TestCase):
    def setUp(self):
        self.editor = "0x" + "1" * 40
        self.reviewer = "0x" + "2" * 40
        self.message = SimpleNamespace(sender_address=self.editor)
        self.museum = {
            str(artwork_id): {
                "id": artwork_id, "title": "Artwork " + str(artwork_id),
                "accession_number": "A." + str(artwork_id),
                "share_license_status": "CC0",
                "images": {"web": {"url": "https://openaccess-cdn.clevelandart.org/a.jpg"}},
            }
            for artwork_id in [1, 2]
        }
        host = ModuleType("genlayer")
        host.TreeMap = TreeMap
        host.u32 = int
        host.allow_storage = lambda cls: cls
        host.gl = SimpleNamespace(
            Contract=object, message=self.message,
            public=SimpleNamespace(view=lambda method: method, write=lambda method: method),
            vm=SimpleNamespace(UserError=UserError),
            eq_principle=SimpleNamespace(strict_eq=lambda fetch: fetch()),
            nondet=SimpleNamespace(web=SimpleNamespace(get=self.fetch)),
        )
        source = Path(__file__).resolve().parents[1] / "contracts" / "collection_register.py"
        with patch.dict(sys.modules, {"genlayer": host}):
            contract = runpy.run_path(str(source))["CollectionRegister"]
        self.contract = contract()
        for name in ("manifests", "editions", "batches", "batch_observations", "releases"):
            setattr(self.contract, name, TreeMap())

    def fetch(self, url):
        item = self.museum[url.rsplit("/", 1)[1]]
        return SimpleNamespace(status=200, body=json.dumps({"data": item}))

    def read_batch(self):
        return json.loads(self.contract.get_batch(self.editor, "sample"))

    def approve(self, artwork_id, version):
        self.message.sender_address = self.reviewer
        self.contract.approve_image(self.editor, "sample", artwork_id, version)
        self.message.sender_address = self.editor

    def test_material_change_invalidates_only_affected_image_and_preserves_release(self):
        self.contract.open_batch("sample", "Sample issue", self.reviewer, "2,1")
        self.approve(1, 1)
        self.approve(2, 1)
        self.contract.issue_release("sample", 1)
        first = self.contract.get_release(self.editor, "sample", 1)

        self.museum["1"]["images"]["web"]["url"] = "https://openaccess-cdn.clevelandart.org/b.jpg"
        self.museum["2"]["title"] = "New descriptive title"
        self.contract.recheck_batch("sample", 1)
        batch = self.read_batch()
        self.assertEqual([entry["version"] for entry in batch["rows"]], [2, 1])
        self.assertEqual(batch["approvals"], {"1": [1], "2": [1]})
        with self.assertRaisesRegex(UserError, "APPROVAL_REQUIRED"):
            self.contract.issue_release("sample", 2)
        self.assertEqual(self.contract.get_release(self.editor, "sample", 1), first)

        self.approve(1, 2)
        self.contract.issue_release("sample", 2)
        release = json.loads(self.contract.get_release(self.editor, "sample", 2))
        self.assertEqual([item["evidence_version"] for item in release["included"]], [2, 1])

    def test_release_rechecks_the_source_before_issuing(self):
        self.contract.open_batch("sample", "Sample issue", self.reviewer, "1")
        self.approve(1, 1)
        self.museum["1"]["share_license_status"] = "Other"
        self.contract.issue_release("sample", 1)
        self.assertEqual(self.read_batch()["revision"], 2)
        self.assertEqual(self.contract.get_release(self.editor, "sample", 1), "")
        with self.assertRaisesRegex(UserError, "NO_ELIGIBLE_IMAGES"):
            self.contract.issue_release("sample", 2)


if __name__ == "__main__":
    unittest.main()
