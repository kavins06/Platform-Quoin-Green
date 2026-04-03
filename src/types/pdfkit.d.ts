declare module "pdfkit" {
  class PDFDocument {
    constructor(options?: Record<string, unknown>);
    page: {
      width: number;
      height: number;
      margins: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
    };
    y: number;
    on(event: string, listener: (...args: any[]) => void): this;
    end(): this;
    addPage(): this;
    save(): this;
    restore(): this;
    rect(x: number, y: number, width: number, height: number): this;
    roundedRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ): this;
    fill(color?: string): this;
    stroke(): this;
    strokeColor(color: string): this;
    lineWidth(value: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(text: string, options?: Record<string, unknown>): this;
    text(
      text: string,
      x: number,
      y: number,
      options?: Record<string, unknown>,
    ): this;
    moveDown(lines?: number): this;
    widthOfString(text: string, options?: Record<string, unknown>): number;
    heightOfString(text: string, options?: Record<string, unknown>): number;
  }

  export default PDFDocument;
}
