# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import re

API = "https://openaccess-api.clevelandart.org/api/artworks/"
IMAGE_PREFIX = "https://openaccess-cdn.clevelandart.org/"


def observations(ids):
    rows = []
    for artwork_id in ids:
        response = gl.nondet.web.get(API + str(artwork_id))
        if response.status == 404:
            rows.append({"id": artwork_id, "state": "missing"})
            continue
        if response.status != 200:
            raise gl.vm.UserError("MUSEUM_API_UNAVAILABLE")
        item = json.loads(response.body)["data"]
        license_status = item["share_license_status"]
        accession = item["accession_number"]
        image = ((item.get("images") or {}).get("web") or {}).get("url")
        if (
            type(item["id"]) is not int
            or item["id"] != artwork_id
            or license_status not in ("CC0", "Copyrighted", "Other")
            or not isinstance(accession, str)
            or not re.fullmatch(r"[A-Za-z0-9.-]{1,60}", accession)
            or not isinstance(item["title"], str)
            or not 0 < len(item["title"]) <= 1000
            or (image is not None and (
                not isinstance(image, str)
                or not image.startswith(IMAGE_PREFIX)
                or len(image) > 350
            ))
        ):
            raise gl.vm.UserError("INVALID_MUSEUM_RECORD")
        rows.append({
            "id": artwork_id,
            "accession": accession,
            "title": item["title"],
            "image": image,
            "license": license_status,
            "state": (
                "restricted" if license_status != "CC0"
                else "public_domain" if image
                else "unavailable"
            ),
        })
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


@allow_storage
class CollectionRegister(gl.Contract):
    editions: TreeMap[str, str]
    manifests: TreeMap[str, str]
    batches: TreeMap[str, str]
    batch_observations: TreeMap[str, str]
    releases: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.view
    def get_manifest(self, owner: str, slug: str) -> str:
        return self.manifests.get(owner.lower() + "/" + slug, "")

    @gl.public.view
    def get_edition(self, owner: str, slug: str, revision: u32) -> str:
        return self.editions.get(owner.lower() + "/" + slug + "/" + str(revision), "")

    @gl.public.write
    def capture(self, slug: str, requested: str, expected_revision: u32) -> None:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", slug):
            raise gl.vm.UserError("INVALID_SLUG")
        if not re.fullmatch(r"[1-9][0-9]{0,8}(,[1-9][0-9]{0,8}){0,3}", requested):
            raise gl.vm.UserError("USE_ONE_TO_FOUR_ARTWORK_IDS")
        ids = sorted(int(value) for value in requested.split(","))
        if len(set(ids)) != len(ids):
            raise gl.vm.UserError("DUPLICATE_ARTWORK_ID")

        owner = str(gl.message.sender_address).lower()
        key = owner + "/" + slug
        prior = self.manifests.get(key, "")
        revision = 0
        if prior:
            manifest = json.loads(prior)
            revision = manifest["revision"]
            if manifest["ids"] != ids:
                raise gl.vm.UserError("ARTWORK_SET_IS_IMMUTABLE")
        if expected_revision != revision:
            raise gl.vm.UserError("STALE_REVISION")

        snapshot = gl.eq_principle.strict_eq(lambda: observations(ids))
        if prior and self.editions[key + "/" + str(revision)] == snapshot:
            return
        revision += 1
        self.editions[key + "/" + str(revision)] = snapshot
        self.manifests[key] = json.dumps({"ids": ids, "revision": revision})

    def _batch(self, owner, slug):
        key = owner.lower() + "/" + slug
        raw = self.batches.get(key, "")
        if not raw:
            raise gl.vm.UserError("BATCH_NOT_FOUND")
        return key, json.loads(raw)

    def _current(self, batch, revision):
        if batch["revision"] != revision:
            raise gl.vm.UserError("STALE_BATCH_REVISION")

    def _store_batch(self, key, batch):
        self.batches[key] = json.dumps(batch, sort_keys=True)

    def _observe_batch(self, key, batch):
        ids = batch["ids"]
        rows = json.loads(gl.eq_principle.strict_eq(lambda: observations(ids)))
        prior = batch["rows"]
        entries = []
        for index, row in enumerate(rows):
            old = prior[index] if prior else None
            version = old["version"] if old else 0
            material = ("state", "license", "image", "accession")
            if not old or any(old["evidence"].get(field) != row.get(field) for field in material):
                version += 1
            entries.append({"evidence": row, "version": version})
        if batch["rows"] == entries:
            return False
        batch["revision"] += 1
        batch["rows"] = entries
        self.batch_observations[key + "/" + str(batch["revision"])] = json.dumps(entries, sort_keys=True)
        return True

    @gl.public.view
    def get_batch(self, owner: str, slug: str) -> str:
        return self.batches.get(owner.lower() + "/" + slug, "")

    @gl.public.view
    def get_batch_observation(self, owner: str, slug: str, revision: u32) -> str:
        key = owner.lower() + "/" + slug + "/" + str(revision)
        return self.batch_observations.get(key, "")

    @gl.public.view
    def get_release(self, owner: str, slug: str, revision: u32) -> str:
        key = owner.lower() + "/" + slug + "/" + str(revision)
        return self.releases.get(key, "")

    @gl.public.write
    def open_batch(self, slug: str, title: str, reviewer: str, requested: str) -> None:
        owner = str(gl.message.sender_address).lower()
        reviewer = reviewer.lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", slug) or not 0 < len(title.strip()) <= 100:
            raise gl.vm.UserError("INVALID_BATCH")
        if not re.fullmatch(r"0x[0-9a-f]{40}", reviewer) or reviewer in (owner, "0x" + "0" * 40):
            raise gl.vm.UserError("DISTINCT_REVIEWER_REQUIRED")
        if not re.fullmatch(r"[1-9][0-9]{0,8}(,[1-9][0-9]{0,8}){0,3}", requested):
            raise gl.vm.UserError("USE_ONE_TO_FOUR_ARTWORK_IDS")
        ids = sorted(int(value) for value in requested.split(","))
        if len(set(ids)) != len(ids):
            raise gl.vm.UserError("DUPLICATE_ARTWORK_ID")
        key = owner + "/" + slug
        if key in self.batches:
            raise gl.vm.UserError("BATCH_ALREADY_EXISTS")
        batch = {
            "title": title.strip(), "reviewer": reviewer, "ids": ids, "revision": 0,
            "rows": [], "approvals": {}, "release_revisions": [],
        }
        self._observe_batch(key, batch)
        self._store_batch(key, batch)

    @gl.public.write
    def recheck_batch(self, slug: str, expected_revision: u32) -> None:
        key, batch = self._batch(str(gl.message.sender_address), slug)
        self._current(batch, expected_revision)
        self._observe_batch(key, batch)
        self._store_batch(key, batch)

    @gl.public.write
    def approve_image(self, owner: str, slug: str, artwork_id: u32, version: u32) -> None:
        key, batch = self._batch(owner, slug)
        if str(gl.message.sender_address).lower() != batch["reviewer"]:
            raise gl.vm.UserError("REVIEWER_REQUIRED")
        if artwork_id not in batch["ids"]:
            raise gl.vm.UserError("ARTWORK_NOT_IN_BATCH")
        entry = batch["rows"][batch["ids"].index(artwork_id)]
        if entry["version"] != version:
            raise gl.vm.UserError("STALE_IMAGE_EVIDENCE")
        if entry["evidence"]["state"] != "public_domain":
            raise gl.vm.UserError("IMAGE_NOT_ELIGIBLE")
        versions = batch["approvals"].setdefault(str(artwork_id), [])
        if version not in versions:
            versions.append(int(version))
            self._store_batch(key, batch)

    @gl.public.write
    def issue_release(self, slug: str, expected_revision: u32) -> None:
        owner = str(gl.message.sender_address).lower()
        key, batch = self._batch(owner, slug)
        self._current(batch, expected_revision)
        if expected_revision in batch["release_revisions"]:
            raise gl.vm.UserError("RELEASE_ALREADY_ISSUED")
        # Recheck inside issuance so stale evidence cannot produce a release.
        if self._observe_batch(key, batch):
            self._store_batch(key, batch)
            return
        included, excluded = [], []
        for entry in batch["rows"]:
            row, version = entry["evidence"], entry["version"]
            if row["state"] != "public_domain":
                excluded.append(dict(row, evidence_version=version))
                continue
            if version not in batch["approvals"].get(str(row["id"]), []):
                raise gl.vm.UserError("APPROVAL_REQUIRED")
            included.append(dict(row, evidence_version=version))
        if not included:
            raise gl.vm.UserError("NO_ELIGIBLE_IMAGES")
        release = {
            "title": batch["title"], "owner": owner, "slug": slug,
            "revision": int(expected_revision), "reviewer": batch["reviewer"],
            "included": included, "excluded": excluded,
        }
        self.releases[key + "/" + str(expected_revision)] = json.dumps(release, sort_keys=True)
        batch["release_revisions"].append(int(expected_revision))
        self._store_batch(key, batch)
