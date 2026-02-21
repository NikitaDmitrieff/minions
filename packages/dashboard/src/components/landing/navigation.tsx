"use client";
import { useState } from "react";
import {
  Navbar,
  NavBody,
  NavItems,
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  NavbarButton,
} from "@/components/ui/resizable-navbar";

const navItems = [
  { name: "How It Works", link: "#how-it-works" },
  { name: "GitHub", link: "https://github.com/NikitaDmitrieff/minions" },
];

export function Navigation() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <Navbar>
      <NavBody>
        <a
          href="#"
          className="relative z-20 px-2 py-1 font-[helvetica] text-sm font-bold tracking-widest text-white"
        >
          MINIONS
        </a>
        <NavItems items={navItems} />
        <NavbarButton href="/login" variant="gradient">
          Sign In
        </NavbarButton>
      </NavBody>
      <MobileNav>
        <MobileNavHeader>
          <a
            href="#"
            className="font-[helvetica] text-sm font-bold tracking-widest text-white"
          >
            MINIONS
          </a>
          <MobileNavToggle
            isOpen={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          />
        </MobileNavHeader>
        <MobileNavMenu
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        >
          {navItems.map((item) => (
            <a
              key={item.name}
              href={item.link}
              className="text-sm text-zinc-300"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {item.name}
            </a>
          ))}
          <NavbarButton href="/login" variant="gradient" className="w-full">
            Sign In
          </NavbarButton>
        </MobileNavMenu>
      </MobileNav>
    </Navbar>
  );
}
