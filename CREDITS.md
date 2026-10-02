# Image credits

The gallery images in `public/gallery/` were downloaded and optimised by
`scripts/prepare-images.mjs` from the sources listed in
`scripts/image-sources.json`. They are shown with their credits on the in-app
**Image credits** page (`/credits`).

| Image | Source | License |
| --- | --- | --- |
| The Starry Night (Van Gogh, 1889), The Scream (Munch, 1893), The Shipwreck of the Minotaur (Turner, c. 1810) | Reproductions from the `jcjohnson/neural-style` repository | Public domain artworks |
| The Great Wave off Kanagawa (Hokusai, c. 1831) | Reproduction from the `lengstrom/fast-style-transfer` repository | Public domain artwork |
| Basket of Fruit (Caravaggio, c. 1599) | Wikimedia Commons file shipped with the `mrdoob/three.js` examples | Public domain artwork |
| Blue Marble | NASA Visible Earth, via the `mrdoob/three.js` examples | Public domain (NASA) |
| Alpine Peaks at Dusk, Pug Portrait, Tabby Gaze | Unsplash photos shipped with the `vercel/next.js` examples | Unsplash License |
| Fluid Pastels | Unsplash photo shipped with the `withastro/astro` examples | Unsplash License |
| Autumn Avenue, Golden Hour Lake, Misty Shoreline, Palm Beach Sunrise, Autumn Canopy, Pansy Garden, Orchid Bloom, Grass Bridge, Water Crown | Demo images from the `nolimits4web/swiper` repository | Distributed with an MIT-licensed project; the photographers are not documented |
| Highland Lake, Potala Palace, Golden Rooftops, River Promenade | Documentation photos from the `fengyuanchen/viewerjs` repository | Distributed with an MIT-licensed project; the photographers are not documented |

## Before a commercial launch

The public-domain artworks, the NASA image and the Unsplash photos are safe to
use. For the Swiper and Viewer.js images the original photographers and their
terms are not documented by those projects. Before running this commercially,
either confirm their licensing or replace them: put new files in
`scripts/image-sources.json` (any URL or a local cache via `--cache`) and run
`npm run images`, which regenerates the optimised files and
`src/shared/catalog.data.json`.
