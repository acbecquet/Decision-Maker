import QRCode from 'qrcode';

/** An SVG string for the text, generated locally so the link never leaves the device to be drawn. */
export function qrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}
