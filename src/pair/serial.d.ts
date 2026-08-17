/**
 * Minimal Web Serial declarations — only the members `src/pair/main.ts` actually uses.
 *
 * The DOM lib does not ship these, and pulling in `@types/w3c-web-serial` would add a
 * dependency for one page. Keeping the surface small also documents exactly how much of the
 * API the pairing flow depends on: open a port at a baud rate, read lines, write lines.
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface Serial extends EventTarget {
  requestPort(): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}
