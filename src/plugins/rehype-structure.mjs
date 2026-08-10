import { visit } from 'unist-util-visit';

// Gives content markdown the same DOM the hand-written pages had, so page
// structure is a property of the markup, not something translators reproduce:
//
//   paragraphs before the first heading -> .page-intro
//   ## heading and what follows         -> .section, heading gets .section-title
//   ### heading inside a section        -> .info-box
//   a lone image                        -> .section-img, unwrapped from its <p>
//   a list inside an info box           -> .contact-list
//
// Everything here is language-independent: it runs the same on all 15 content
// folders.

const div = (className, children) => ({
  type: 'element',
  tagName: 'div',
  properties: { className: [className] },
  children,
});

const isElement = (node, tag) => node?.type === 'element' && node.tagName === tag;

// Markdown wraps a lone image in a paragraph; pull it back out.
function loneImage(node) {
  if (isElement(node, 'img')) return node;
  if (!isElement(node, 'p')) return null;
  const real = node.children.filter((c) => c.type !== 'text' || c.value.trim() !== '');
  return real.length === 1 && isElement(real[0], 'img') ? real[0] : null;
}

export function rehypeStructure() {
  return (tree) => {
    const out = [];
    let section = null;
    let infoBox = null;
    let seenImage = false;

    const push = (node) => {
      const parent = infoBox ?? section;
      if (parent) parent.children.push(node);
      else out.push(node);
    };
    const openSection = () => {
      section = div('section', []);
      infoBox = null;
      out.push(section);
    };

    for (const node of tree.children) {
      if (node.type === 'text' && !node.value.trim()) continue;

      if (isElement(node, 'h2')) {
        node.properties.className = [...(node.properties.className ?? []), 'section-title'];
        openSection();
        section.children.push(node);
        continue;
      }

      if (isElement(node, 'h3') && section) {
        infoBox = div('info-box', [node]);
        section.children.push(infoBox);
        continue;
      }

      const img = loneImage(node);
      if (img) {
        img.properties.className = [...(img.properties.className ?? []), 'section-img'];
        if (seenImage) img.properties.loading = 'lazy';
        seenImage = true;
        push(img);
        continue;
      }

      if (isElement(node, 'ul') && infoBox) {
        node.properties.className = [...(node.properties.className ?? []), 'contact-list'];
      }

      if (isElement(node, 'p') && !section) {
        node.properties.className = [...(node.properties.className ?? []), 'page-intro'];
      }

      push(node);
    }

    tree.children = out;

    // External links open in a new tab, as they did in the hand-written pages.
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;
      const href = String(node.properties?.href ?? '');
      if (!/^https?:\/\//.test(href)) return;
      node.properties.target = '_blank';
      node.properties.rel = 'noopener';
    });
  };
}
