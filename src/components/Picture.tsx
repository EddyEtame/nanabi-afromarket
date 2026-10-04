import manifest from "./picture-manifest.json";

type Entry = { w: number; h: number; widths: number[] };

/** Responsive AVIF/WebP with the original JPEG as fallback; variants come from tools/optimize_images.py. */
export function Picture({
  src,
  alt,
  className,
  sizes = "100vw",
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  const entry = (manifest as Record<string, Entry>)[src];
  if (!entry) {
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer
    return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
  }
  const stem = src.replace(/\.jpg$/, "");
  const set = (ext: string) => entry.widths.map((w) => `${stem}-${w}.${ext} ${w}w`).join(", ");
  return (
    <picture>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
      <img src={src} alt={alt} className={className} width={entry.w} height={entry.h} loading="lazy" decoding="async" />
    </picture>
  );
}
