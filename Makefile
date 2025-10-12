.PHONY: render cmyk start

# Config
RENDER_URL ?= http://localhost:1313
OUT_DIR    ?= /Users/kb0/stick

# Ghostscript options for high-quality CMYK PDF
GS_OPTS = -dSAFER -dBATCH -dNOPAUSE \
  -sDEVICE=pdfwrite \
  -dProcessColorModel=/DeviceCMYK \
  -sColorConversionStrategy=CMYK \
  -sColorConversionStrategyForImages=CMYK \
  -dEmbedAllFonts=true \
  -dSubsetFonts=true \
  -dCompatibilityLevel=1.4 \
  -dAutoFilterColorImages=false \
  -dColorImageFilter=/DCTEncode \
  -dJPEGQ=90 \
  -dAutoFilterGrayImages=false \
  -dGrayImageFilter=/DCTEncode

start:
	@TIMESTAMP=$$(date +%Y-%m-%d-%H-%M); \
	OUT="$(OUT_DIR)/combined-$$TIMESTAMP.pdf"; \
	node automation.mjs "$(RENDER_URL)" -o "$$OUT" -k 10 -c 3; \
	echo "$$OUT" > .last_output; \
	echo "Rendered: $$OUT"

cmyk:
	@FILE=$$(cat .last_output 2>/dev/null || true); \
	if [ -z "$$FILE" ] || [ ! -f "$$FILE" ]; then \
	  echo "No source PDF found. Run 'make start' or 'make start' first."; exit 1; \
	fi; \
	OUT_CMYK="$${FILE%.pdf}_cmyk.pdf"; \
	gs $(GS_OPTS) -sOutputFile="$$OUT_CMYK" "$$FILE"; \
	echo "CMYK: $$OUT_CMYK"

magic:
	@$(MAKE) start
	@$(MAKE) cmyk
