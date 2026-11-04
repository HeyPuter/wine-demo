# The Wine desktop demo's site, from a gex checkout (GEX) and a gate Wine dist (DIST). env.sh holds every
# other path and host (env.local overrides it); outputs go to WD_OUT, never here.
#   make site GEX=<gex checkout> DIST=<GATE_W64/dist64-K-...-wow64-...-nN64-N32-sS> SITE=sW7
#   make check SITE=sW7          (the site served at env.sh's URL)
# Each step is its own target too: runtime, dist, test-apps, prefix, bundle, pipeline, drops, check, serve,
# and apps (WN's recipe; long, only when the apps change).
SHELL := /bin/bash
B := $(CURDIR)/bin
SITE ?= sW7
TAG ?= $(shell echo $(SITE) | tr A-Z a-z)
export GEX DIST

.PHONY: site runtime dist test-apps prefix bundle pipeline drops check serve apps
site: runtime dist test-apps prefix bundle pipeline

runtime:
	$(B)/runtime.sh
dist:
	@[ -n "$(DIST)" ] || { echo 'make: set DIST to a gate native-i386 WoW64 dist'; exit 2; }
	$(B)/dist.sh $(DIST)
test-apps:
	$(B)/test-apps.sh
prefix: test-apps
	$(B)/mkapps.sh
bundle:
	$(B)/mkbundle.sh
pipeline:
	$(B)/pipeline.sh $(TAG) $(SITE)
drops: test-apps
	$(B)/drops.sh
check: drops
	$(B)/check.sh $(TAG) $(STEPS)
serve:
	$(B)/serve.sh $(SITE)
apps:
	$(B)/apps.sh
