# Clutch Clicks Setter Discovery Call Script (Cloudflare Pages site)

A static site. No build step.

- `index.html` is the whole page: the script, the note, the pipeline, booking and shop time tabs.
- `_headers` tells search engines not to index the site.

To change the page: edit `index.html` and commit. Cloudflare republishes the site on every commit.

Cloudflare Pages settings: framework preset None, build command empty, build output directory `/`.
