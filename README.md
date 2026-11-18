# Collection Register

Collection Register is an image-release workspace for editorial teams. An editor prepares a publication batch and assigns a reviewer. The reviewer signs off on individual images. The editor issues a downloadable list for the team assembling the publication, with each included image tied to the evidence the reviewer saw.

[Publication desk](https://chuanqili77.github.io/collection-register-genlayer/) · [Stable Studionet contract](https://explorer-studio.genlayer.com/address/0xE9E887287f355e740d5213b327389f167FcC1C78)

## Review the live example

[Open the released illustrated issue](https://chuanqili77.github.io/collection-register-genlayer/?owner=0x666b7e6ddbcdf692fc3821341e26ff3759dea7e3&batch=illustrated-issue#register) without a wallet. The batch includes the signed-off CC0 image *Stag at Sharkey’s* and excludes *La Vie*, which the museum marks as copyrighted. The same chain record is available as a handoff download.

[Acceptance transaction hashes](demo.json) cover batch creation, reviewer sign-off, issuance, and four expected rejections. Run `node scripts/verify-batch.mjs` to verify the deployed source, finalized receipts and release readback without writing to the chain.

## Editorial workflow

1. **Editor** — Open a batch with a title, an independent reviewer wallet and up to four Cleveland Museum of Art artwork IDs. Share the batch URL with the reviewer.
2. **Reviewer** — Inspect the museum evidence for each image. Sign off only on the current evidence version of an eligible image. The contract excludes non-CC0, missing and unavailable images from the release.
3. **Editor** — Issue the release list once every eligible image has been signed off. The contract checks the museum again inside the issuance transaction. If the source has changed, the transaction records the new snapshot for review and issues no list.
4. **Production team** — Open the batch without a wallet and download the finalized JSON. It contains the included assets, exclusions, editor, reviewer, evidence versions and on-chain reference.

After issuance, the editor can recheck the museum. A change to the share license, image URL, accession or availability advances the evidence version for that image. An earlier sign-off cannot approve the changed version. Sign-offs for unaffected images carry forward, and historical release lists remain available from the evidence selector.

## Evidence and scope

GenLayer validators independently query the museum's [Open Access API](https://www.clevelandart.org/open-access-api). The contract applies strict equality to normalized observations. A temporary source error stops the write. An HTTP 404 is recorded as missing evidence and blocks inclusion. This workflow applies a conservative CC0-with-web-image policy to a single institution. The museum URL identifies the source asset, and the release records what the institution reported at issuance. The contract does not verify image bytes, apply changes to a publishing system, or issue a legal clearance opinion.

The cover is *The Biglin Brothers Turning the Stake*, courtesy of the [Cleveland Museum of Art](https://www.clevelandart.org/art/1927.1984). Earlier single-publisher records remain accessible through the site's original register archive.

## Run and verify

Use Node.js 24 and Python 3.

```sh
npm ci
npm run dev
npm run build -- --base=./
python -m unittest discover -s tests
```

[deployment.json](deployment.json) pins the address and deployment transaction. `npm run deploy` deploys the source using a fresh key on zero-gas Stable Studionet. `node scripts/check-batch.mjs` submits an acceptance run with independent temporary testnet wallets. The Python tests simulate a source change to check re-review and historical release preservation.
