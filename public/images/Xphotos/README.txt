X bot image folders

Pregame starter photos:
- Put starting pitcher photos in pregame/pitchers/
- Filenames must be lowercase kebab-case: firstname-lastname.jpg
- Example: Kodai Senga -> pregame/pitchers/kodai-senga.jpg
- Required fallback: pregame/pitchers/default.jpg

Postgame player and result photos:
- Put postgame photos in postgame/
- Filenames must be lowercase kebab-case: firstname-lastname.jpg
- Examples:
  - Francisco Lindor -> postgame/francisco-lindor.jpg
  - Juan Soto -> postgame/juan-soto.jpg
  - Devin Williams -> postgame/devin-williams.jpg
- Required win fallback: postgame/defaultpostgamewin.jpg
- Required loss fallback: postgame/metslose.jpg

Name normalization:
- Lowercase player names.
- Remove punctuation, accents, suffixes, and extra spaces.
- Replace spaces with hyphens.
