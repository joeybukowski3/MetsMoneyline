const fs = require("fs");

function replaceHtmlBlock(filePath, markerName, innerHtml) {
  const startMarker = `<!-- ${markerName}:START -->`;
  const endMarker = `<!-- ${markerName}:END -->`;
  const source = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

  if (!pattern.test(source)) {
    throw new Error(`Missing marker block ${markerName} in ${filePath}`);
  }

  const replacement = `${startMarker}\n${innerHtml}\n${endMarker}`;
  fs.writeFileSync(filePath, source.replace(pattern, replacement));
}

module.exports = replaceHtmlBlock;
