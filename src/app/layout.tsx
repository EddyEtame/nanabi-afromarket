import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Cormorant_Garamond, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { facts } from "@/content/site";
import "./globals.css";
import "./sections.css";
import "./hero.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-bodoni",
  display: "swap",
});
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const SITE_URL = "https://nanabi-afromarket.fr";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "NANABi AFROMARKET · Wax, perruques et cosmétique afro à Toulouse Saint-Cyprien",
  description:
    "Boutique afro au 34, rue de la République, à Toulouse Saint-Cyprien : robes et ensembles en wax, perruques et geles, beurres et soins capillaires, perles, cauris et plantes séchées. Métro A Saint-Cyprien – République.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "NANABi AFROMARKET",
    title: "NANABi AFROMARKET · la boutique afro de Saint-Cyprien",
    description: "Poussez la porte : wax, perruques, geles, perles et cosmétique afro, rue de la République à Toulouse.",
    images: [{ url: "/og/home.jpg", width: 1200, height: 630, alt: "La devanture de NANABi AFROMARKET, la nuit, vitrine allumée" }],
  },
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const storeJsonLd = {
  "@context": "https://schema.org",
  "@type": "Store",
  name: facts.name,
  alternateName: facts.shortName,
  url: SITE_URL,
  telephone: "+33 7 84 60 89 09",
  email: facts.email,
  address: {
    "@type": "PostalAddress",
    streetAddress: "34 rue de la République",
    postalCode: facts.postcode,
    addressLocality: facts.city,
    addressCountry: "FR",
  },
  areaServed: "Toulouse",
  sameAs: facts.socials.map((s) => s.href),
};

// Applies the saved art direction, ending and language before first paint, so toggles never flash.
const bootScript = `(function(){var d=document.documentElement;d.classList.add('js');try{var h=location.hash.slice(1),s=localStorage;
var ad=(/^ad-(lexique|galerie|ecrin)$/.exec(h)||[])[1]||s.getItem('nb-ad');if(ad)d.dataset.ad=ad;
var en=s.getItem('nb-ending');if(en)d.dataset.ending=en;var l=s.getItem('nb-lang');if(l){d.lang=l;d.dataset.lang=l;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      data-ad="lexique"
      data-ending="a"
      data-lang="fr"
      className={`${cormorant.variable} ${bodoni.variable} ${instrument.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(storeJsonLd) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
