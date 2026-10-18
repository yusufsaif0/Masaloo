# Local bill OCR models

The compressed English (`eng`) and Hindi (`hin`) models are bundled so bill images do not need an external OCR service, runtime language download, or API key. Server-side OCR uses Tesseract.js 6.0.1 and these Tesseract LSTM models.

Source: [tesseract-ocr/tessdata_fast, tag 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0). Models are distributed under Apache License 2.0; see `LICENSE.txt`.

SHA-256 of the original uncompressed `.traineddata` files:

| Language | SHA-256 |
| --- | --- |
| English | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| Hindi | `4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825` |

Keep this directory in the runtime application bundle. OCR runs in a separate, bounded child process, with one reading job at a time per application process. Image text is an editable suggestion, never an automatically approved financial entry.
