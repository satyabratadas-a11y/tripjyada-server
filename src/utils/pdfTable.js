const BRAND_DARK = '#171717';
const BRAND_ORANGE = '#F2701C';
const BORDER = '#E5E7EB';
const ZEBRA = '#FAFAFA';
const TEXT = '#1F2937';
const SUBTEXT = '#6B7280';

const CELL_PAD_X = 6;
const CELL_PAD_Y = 5;
const HEADER_FONT_SIZE = 9;
const BODY_FONT_SIZE = 9;

/**
 * Draws a left-bordered table that reflows across pages, redrawing the header row on each new
 * page. Columns are plain strings (an embedded '\n' is fine — pdfkit wraps within `width` too),
 * so callers pre-format multi-line cells rather than this helper knowing about row semantics.
 */
function drawTable(doc, { x, top, columns, rows, zebra = true }) {
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  let y = top;

  function columnX(index) {
    let cx = x;
    for (let i = 0; i < index; i += 1) cx += columns[i].width;
    return cx;
  }

  function drawHeader() {
    doc.font('Helvetica-Bold').fontSize(HEADER_FONT_SIZE);
    const headerHeight =
      Math.max(...columns.map((col) => doc.heightOfString(col.header, { width: col.width - CELL_PAD_X * 2 }))) +
      CELL_PAD_Y * 2;

    doc.rect(x, y, tableWidth, headerHeight).fill(BRAND_DARK);
    doc.fillColor('#FFFFFF');
    columns.forEach((col, i) => {
      doc.text(col.header, columnX(i) + CELL_PAD_X, y + CELL_PAD_Y, {
        width: col.width - CELL_PAD_X * 2,
        align: col.align || 'left',
      });
    });
    y += headerHeight;
  }

  function pageBottom() {
    return doc.page.height - doc.page.margins.bottom;
  }

  drawHeader();

  rows.forEach((row, rowIndex) => {
    // heightOfString has no font/fontSize option of its own — it measures using whatever font is
    // currently active on `doc`, so that has to be set explicitly before every measurement (not
    // just once before the loop): drawHeader() below switches to Helvetica-Bold on a page break,
    // and without resetting it again afterwards the row that triggered the break would render in
    // the header's bold font instead of the body font.
    doc.font('Helvetica').fontSize(BODY_FONT_SIZE);
    const cellHeights = row.map((cell, i) =>
      doc.heightOfString(String(cell ?? ''), { width: columns[i].width - CELL_PAD_X * 2 })
    );
    const rowHeight = Math.max(...cellHeights) + CELL_PAD_Y * 2;

    if (y + rowHeight > pageBottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }

    if (zebra && rowIndex % 2 === 1) {
      doc.rect(x, y, tableWidth, rowHeight).fill(ZEBRA);
    }

    doc.font('Helvetica').fontSize(BODY_FONT_SIZE).fillColor(TEXT);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ''), columnX(i) + CELL_PAD_X, y + CELL_PAD_Y, {
        width: columns[i].width - CELL_PAD_X * 2,
        align: columns[i].align || 'left',
      });
    });

    doc
      .moveTo(x, y + rowHeight)
      .lineTo(x + tableWidth, y + rowHeight)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();

    y += rowHeight;
  });

  return y;
}

/** A row of equal-width stat tiles — e.g. the team/employee summary KPIs. */
function drawStatTiles(doc, { x, top, width, tiles, columns = 3 }) {
  const gap = 10;
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = 52;

  tiles.forEach((tile, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const tx = x + col * (tileWidth + gap);
    const ty = top + row * (tileHeight + gap);

    doc.roundedRect(tx, ty, tileWidth, tileHeight, 4).fillAndStroke('#FFFFFF', BORDER);
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(tile.accent || BRAND_ORANGE)
      .text(String(tile.value), tx + 10, ty + 8, { width: tileWidth - 20 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(SUBTEXT)
      .text(tile.label.toUpperCase(), tx + 10, ty + 32, { width: tileWidth - 20, characterSpacing: 0.3 });
  });

  const rowCount = Math.ceil(tiles.length / columns);
  return top + rowCount * tileHeight + (rowCount - 1) * gap;
}

/** A bold section title with a short brand-colored accent bar, used above every table/tile block. */
function drawSectionTitle(doc, { x, top, text }) {
  doc.rect(x, top + 2, 3, 14).fill(BRAND_ORANGE);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_DARK).text(text, x + 10, top);
  return top + 24;
}

module.exports = { drawTable, drawStatTiles, drawSectionTitle, BRAND_DARK, BRAND_ORANGE, BORDER, TEXT, SUBTEXT };
