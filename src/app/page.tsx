import { PrefsProvider } from "@/lib/prefs";
import { DemoBar } from "@/components/DemoBar";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/hero/Hero";
import { Letter } from "@/components/sections/Letter";
import { Aisles } from "@/components/sections/Aisles";
import { Lexicon } from "@/components/sections/Lexicon";
import { Heads } from "@/components/sections/Heads";
import { Gold } from "@/components/sections/Gold";
import { Visit } from "@/components/sections/Visit";
import { Footer } from "@/components/sections/Footer";
import { Motion } from "@/components/Motion";

export default function Home() {
  return (
    <PrefsProvider>
      <DemoBar />
      <Nav />
      <main id="top">
        <Hero />
        <Letter />
        <Aisles />
        <Lexicon />
        <Heads />
        <Gold />
        <Visit />
      </main>
      <Footer />
      <Motion />
    </PrefsProvider>
  );
}
