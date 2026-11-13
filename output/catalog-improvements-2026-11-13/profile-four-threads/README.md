# Isolated BiRefNet performance WIP — not merged

This diagnostic is intentionally outside main. It profiles the existing rembg/BiRefNet CPU session, preprocessing, inference and alpha matting on retained authentic local images. It creates diagnostic output only and does not register or publish media. No source is overwritten; do not use its masks as approved product assets.

The measured four-thread/no-arena run failed the production 60-second budget: cold loading 57.451 s; first inference 135.308 s; second warm inference 85.247 s. These options were slower than the earlier two-thread measurements and were not adopted. Matting remained foreground=240/background=10/erode_size=5. The diagnostic outputs were visually inspected for white packaging/label retention, but are not production approvals. Production continues using the asynchronous failed-derivative/authentic-original fallback merged in d788c42.

Example with the existing Python environment and already retained model:

    python apps/api/scripts/profile-birefnet.py <authentic-image-1> <authentic-image-2> --output <new-diagnostic-directory> --threads 4 --no-arena

Do not change production timeouts or assume this is a performance fix. Further work requires measured improvements within the existing runtime budget. Original unmerged image work at 242c6fd is preserved independently.
