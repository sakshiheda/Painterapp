'use strict';

/**
 * GET /api/v1/marker.pdf  ?sizeMm=100
 *
 * Returns a printable A4 PDF with a single QR-code calibration marker.
 * The QR encodes "painterapp:marker:v1:<sizeMm>" so the server can
 * recover the physical size from the photo without the user having to
 * type it in.
 *
 * Print this on plain white paper at 100% scale (no "fit to page"!),
 * place flat in the same plane as whatever you want to measure, take
 * a photo from any reasonable angle. Server detects it and computes
 * an exact perspective-correct mapping from pixels to millimetres.
 */

const express = require('express');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { MARKER_PREFIX } = require('../services/marker');

const router = express.Router();

// PDFKit measures everything in points: 72 pt = 1 inch = 25.4 mm
const PT_PER_MM = 72 / 25.4;

router.get('/marker.pdf', async (req, res, next) => {
  try {
    let sizeMm = Number.parseFloat(req.query.sizeMm);
    if (!Number.isFinite(sizeMm) || sizeMm <= 10 || sizeMm > 250) {
      sizeMm = 100; // default 100 mm
    }
    sizeMm = Math.round(sizeMm * 10) / 10; // 0.1 mm precision
    const payload = `${MARKER_PREFIX}${sizeMm}`;

    // Render QR as a high-resolution PNG buffer (margin 0 — we add our
    // own framing). 1024 px → at any print size we stay well above
    // the laser-printer's smallest module.
    const png = await QRCode.toBuffer(payload, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 0,
      scale: 16,
    });

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="painterapp-marker-${sizeMm}mm.pdf"`
    );
    doc.pipe(res);

    // ----- Layout (A4 = 210 × 297 mm) -----
    const pageWmm = 210;
    const sizePt = sizeMm * PT_PER_MM;
    const xPt = ((pageWmm - sizeMm) / 2) * PT_PER_MM;
    const yPt = 30 * PT_PER_MM; // 30 mm from top

    // Title
    doc.font('Helvetica-Bold').fontSize(20)
      .text('PainterApp Calibration Marker', 0, 12 * PT_PER_MM, {
        width: pageWmm * PT_PER_MM,
        align: 'center',
      });
    doc.font('Helvetica').fontSize(11).fillColor('#444')
      .text(`${sizeMm} mm × ${sizeMm} mm  ·  Print at 100% scale  ·  Do NOT "fit to page"`,
        0, 21 * PT_PER_MM, {
          width: pageWmm * PT_PER_MM,
          align: 'center',
        });

    // The QR itself
    doc.image(png, xPt, yPt, { width: sizePt, height: sizePt });

    // Crop / size-check rulers around the QR
    const tickColor = '#000';
    doc.lineWidth(0.6).strokeColor(tickColor);
    // Top tick
    doc.moveTo(xPt, yPt - 4 * PT_PER_MM).lineTo(xPt, yPt - 1 * PT_PER_MM).stroke();
    doc.moveTo(xPt + sizePt, yPt - 4 * PT_PER_MM).lineTo(xPt + sizePt, yPt - 1 * PT_PER_MM).stroke();
    doc.moveTo(xPt, yPt - 2.5 * PT_PER_MM).lineTo(xPt + sizePt, yPt - 2.5 * PT_PER_MM).stroke();
    doc.fontSize(9).fillColor('#000')
      .text(`${sizeMm} mm`, xPt, yPt - 7 * PT_PER_MM, { width: sizePt, align: 'center' });

    // Side tick
    doc.moveTo(xPt - 4 * PT_PER_MM, yPt).lineTo(xPt - 1 * PT_PER_MM, yPt).stroke();
    doc.moveTo(xPt - 4 * PT_PER_MM, yPt + sizePt).lineTo(xPt - 1 * PT_PER_MM, yPt + sizePt).stroke();
    doc.moveTo(xPt - 2.5 * PT_PER_MM, yPt).lineTo(xPt - 2.5 * PT_PER_MM, yPt + sizePt).stroke();
    doc.save().rotate(-90, { origin: [xPt - 6 * PT_PER_MM, yPt + sizePt / 2] })
      .text(`${sizeMm} mm`, xPt - 6 * PT_PER_MM - sizePt / 2, yPt + sizePt / 2 - 5,
        { width: sizePt, align: 'center' })
      .restore();

    // Instructions
    const instrY = yPt + sizePt + 14 * PT_PER_MM;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
      .text('How to use', 18 * PT_PER_MM, instrY);
    doc.font('Helvetica').fontSize(11).fillColor('#222')
      .text('1.  Print this page on plain white A4 paper at 100% scale.', 18 * PT_PER_MM, instrY + 6 * PT_PER_MM);
    doc.text('2.  Verify the side rulers above measure exactly ' + sizeMm + ' mm with a real ruler.',
      18 * PT_PER_MM, instrY + 12 * PT_PER_MM);
    doc.text('3.  Tape the marker flat in the same plane as whatever you want to measure',
      18 * PT_PER_MM, instrY + 18 * PT_PER_MM);
    doc.text('     (the wall, gate, floor tile, etc.).', 18 * PT_PER_MM, instrY + 24 * PT_PER_MM);
    doc.text('4.  Photograph from any reasonable angle. Make sure the entire QR is in frame.',
      18 * PT_PER_MM, instrY + 30 * PT_PER_MM);
    doc.text('5.  Upload — the server will detect the marker and calibrate automatically.',
      18 * PT_PER_MM, instrY + 36 * PT_PER_MM);

    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666')
      .text(`encoded payload: ${payload}`, 0, 285 * PT_PER_MM, {
        width: pageWmm * PT_PER_MM, align: 'center',
      });

    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
