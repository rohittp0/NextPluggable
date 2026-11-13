import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About' };

export default function About() {
  return (
    <section className="wrap hero">
      <h1>About</h1>
      <p>A page that belongs to the site itself. The site&apos;s own routes always win over pages added by plugins.</p>
    </section>
  );
}
