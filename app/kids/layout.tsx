// Kids subtree layout — preconnects the YouTube origins so feed
// thumbnails (i.ytimg.com), the IFrame API script
// (www.youtube.com) and the player iframe document
// (www.youtube-nocookie.com) skip DNS+TLS setup on first use.
// React 19 hoists <link> elements rendered in components into
// <head>.
export default function KidsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="preconnect" href="https://www.youtube.com" />
      <link
        rel="preconnect"
        href="https://www.youtube-nocookie.com"
      />
      <link rel="preconnect" href="https://i.ytimg.com" />
      {children}
    </>
  );
}
