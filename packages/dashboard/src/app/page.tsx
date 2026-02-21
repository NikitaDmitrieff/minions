import { Navigation } from "@/components/landing/navigation";
import { Hero } from "@/components/landing/sections/hero";
import { HowItWorks } from "@/components/landing/sections/how-it-works";
import { FooterSection } from "@/components/landing/sections/footer-section";

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-black">
      <Navigation />
      <Hero />
      <HowItWorks />
      <FooterSection />

      {/* Viewport corner frame overlay */}
      <div className="fixed inset-0 z-50 pointer-events-none" aria-hidden="true">
        {/* Top-left */}
        <div className="absolute top-6 left-6 h-2 w-2 rounded-full bg-[#1a1ab0] opacity-20 animate-pulse" />
        <div className="absolute top-6 left-6 w-5 h-px bg-[#1a1ab0]/15" />
        <div className="absolute top-6 left-6 w-px h-5 bg-[#1a1ab0]/15" />
        {/* Top-right */}
        <div className="absolute top-6 right-6 h-2 w-2 rounded-full bg-[#1a1ab0] opacity-20 animate-pulse" style={{ animationDelay: "0.4s" }} />
        <div className="absolute top-6 right-6 w-5 h-px bg-[#1a1ab0]/15" />
        <div className="absolute top-6 right-6 w-px h-5 bg-[#1a1ab0]/15" />
        {/* Bottom-left */}
        <div className="absolute bottom-6 left-6 h-2 w-2 rounded-full bg-[#1a1ab0] opacity-20 animate-pulse" style={{ animationDelay: "0.8s" }} />
        <div className="absolute bottom-6 left-6 w-5 h-px bg-[#1a1ab0]/15" />
        <div className="absolute bottom-6 left-6 w-px h-5 bg-[#1a1ab0]/15" />
        {/* Bottom-right */}
        <div className="absolute bottom-6 right-6 h-2 w-2 rounded-full bg-[#1a1ab0] opacity-20 animate-pulse" style={{ animationDelay: "1.2s" }} />
        <div className="absolute bottom-6 right-6 w-5 h-px bg-[#1a1ab0]/15" />
        <div className="absolute bottom-6 right-6 w-px h-5 bg-[#1a1ab0]/15" />
      </div>
    </main>
  );
}
