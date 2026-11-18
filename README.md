# Collection Register

Collection Register is a GenLayer application for curators and publishers who need a shared record of what a museum reported about a set of digital images. Each edition records the Cleveland Museum of Art's current share-license field, web image URL, accession number and title. Anyone can read the finalized editions and compare each edition to its predecessor.

## Use the register

Open the [website](https://chuanqili77.github.io/collection-register-genlayer/). Enter a publisher wallet and a register name to browse finalized editions. To publish from your own wallet, enter a new register name and one to four museum artwork IDs, then choose **Publish or recheck**. Stable Studionet requires an EIP-1193 wallet for writes. The website links to the transaction and updates the register after successful finality.

Recheck the same IDs using the same wallet and register name. A changed response adds a new edition. An unchanged response finalizes without creating another edition. The list of artwork IDs is fixed when the first edition is finalized.

## How consensus works

Validators independently fetch each artwork from the museum's [Open Access API](https://www.clevelandart.org/open-access-api). The contract uses GenLayer's strict equality rule over a sorted, normalized snapshot of the museum fields. A revision check prevents two concurrent updates from silently overwriting each other. Previous editions remain readable.

The register records the museum's published status and web URL. It does not verify the bytes behind that URL or establish legal rights. Check the institution's current guidance before reusing an image. The cover image is *The Biglin Brothers Turning the Stake* by Thomas Eakins, courtesy of the [Cleveland Museum of Art](https://www.clevelandart.org/art/1927.1984).

## Run locally

Use Node.js 24.

```sh
npm ci
npm run dev
npm run build -- --base=./
```

The frontend uses [the deployed Stable Studionet contract](https://explorer-studio.genlayer.com/address/0xD9D9E9038E1FfB24Fa689382b0b3077c0492afDa). The address and deployment hash are in [deployment.json](deployment.json). Run `npm run deploy` to deploy the contract using a fresh key on zero-gas Studionet, or pass an existing deployment transaction hash to verify and record its deployment. Run `node scripts/check.mjs` to exercise publication and unchanged recheck against the configured deployment.
