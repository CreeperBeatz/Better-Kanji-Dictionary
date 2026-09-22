#!/bin/sh
# Download the source data the pipeline needs (run from pipeline/).
set -e
curl -sL -o cjk-decomp.txt   "https://raw.githubusercontent.com/scriptin/topokanji/master/data/cjk-decomp-0.4.0.txt"
curl -sL -o cjk-override.txt "https://raw.githubusercontent.com/scriptin/topokanji/master/data/cjk-decomp-override.txt"
curl -sL -o kanji.json       "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json"
