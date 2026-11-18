# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import re

API = "https://openaccess-api.clevelandart.org/api/artworks/"
IMAGE_PREFIX = "https://openaccess-cdn.clevelandart.org/"


def observations(ids):
    rows = []
    for artwork_id in ids:
        response = gl.nondet.web.request(API + str(artwork_id), method="GET")
        if response.status_code == 404:
            rows.append({"id": artwork_id, "state": "missing"})
            continue
        if response.status_code != 200:
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
