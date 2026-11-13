// Kids subtree layout — preconnects the YouTube origins so feed
// thumbnails (i.ytimg.com) and the watch page's IFrame API
// (www.youtube.com) skip DNS+TLS setup on first use. React 19 hoists
// <link> elements rendered in components into <head>.
export default function KidsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="preconnect" href="https://www.youtube.com" />
      <link rel="preconnect" href="https://i.ytimg.com" />
      {children}
    </>
  );
}
