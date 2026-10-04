/** Browser-only: shrink a photo to a JPEG data URL small enough to store (receipts, phone camera shots). */
export function downsizeImage(file: File, maxEdge = 1600, startQuality = 0.82, maxChars = 3_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let q = startQuality;
      let out = canvas.toDataURL("image/jpeg", q);
      while (out.length > maxChars && q > 0.4) { q -= 0.1; out = canvas.toDataURL("image/jpeg", q); }
      out.length > maxChars ? reject(new Error("too-large")) : resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    img.src = url;
  });
}
