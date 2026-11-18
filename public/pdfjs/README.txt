pdf.js 的 CMap（cmaps/）和标准字体（standard_fonts/），从 node_modules/pdfjs-dist 原样拷来（4.10.38，2026-11-12）。
升级 pdfjs-dist 时要一起重新拷：
  cp -r node_modules/pdfjs-dist/cmaps node_modules/pdfjs-dist/standard_fonts public/pdfjs/
用途见 src/exam/ExamRoom.tsx 的 PDF_ASSETS。
