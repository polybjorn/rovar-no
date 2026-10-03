import { visit } from 'unist-util-visit';

// Gives content markdown the same DOM the hand-written pages had, so page
// structure is a property of the markup, not something translators reproduce:
//
//   paragraphs before the first heading -> .page-intro
//   ## heading and what follows         -> .section, heading gets .section-title
//   ### heading inside a section        -> .info-box
//   a lone image                        -> .section-img, unwrapped from its <p>
//   a list inside an info box           -> .contact-list
//   a list of nothing but links         -> .link-list
//   a list of "**Label:** value" lines  -> .fact-list
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

// A list whose every item is one link and nothing else: a place's web
// address, email and phone. A line that labels its link in words ("E-post:
// ...") keeps the list plain.
function linksOnly(node) {
  const items = node.children.filter((c) => isElement(c, 'li'));
  return items.length > 0 && items.every((li) => {
    const real = li.children.filter((c) => c.type !== 'text' || c.value.trim() !== '');
    return real.length === 1 && isElement(real[0], 'a');
  });
}

// A list whose every item opens with a bold label and goes on with its value:
// opening hours, prices, a tour's departures.
function labelled(node) {
  const items = node.children.filter((c) => isElement(c, 'li'));
  return items.length > 0 && items.every((li) => {
    const real = li.children.filter((c) => c.type !== 'text' || c.value.trim() !== '');
    return real.length > 1 && isElement(real[0], 'strong');
  });
}

// A fact-list row as label, value and, when the row ends in emphasis, when it
// applies: "**Hver dag:** kl. 11.00 _til 16. august_". Each part is a cell of
// the list's grid, so times and dates each line up down the list.
function factRow(li) {
  const real = li.children.filter((c) => c.type !== 'text' || c.value.trim() !== '');
  const [label, ...rest] = real;
  const last = rest.at(-1);
  const when = rest.length > 1 && isElement(last, 'em') ? rest.pop() : null;
  const at = li.children.indexOf(rest[0]);
  const value = li.children.slice(at, when ? li.children.indexOf(when) : undefined);
  li.children = [
    label,
    { type: 'element', tagName: 'span', properties: { className: ['fact-value'] }, children: value },
    ...(when ? [{ ...when, tagName: 'span', properties: { className: ['fact-when'] } }] : []),
  ];
}

// Email and phone share one item, so the list wraps them together: never the
// phone number alone on a line of its own under the email.
const isContact = (li) => li.children.some((c) => isElement(c, 'a')
  && /^(mailto|tel):/.test(String(c.properties?.href ?? '')));

function groupContact(node) {
  const contact = node.children.filter((c) => isElement(c, 'li') && isContact(c));
  if (contact.length < 2) return;
  const group = {
    type: 'element',
    tagName: 'li',
    properties: { className: ['link-contact'] },
    children: contact.flatMap((li) => li.children.filter((c) => isElement(c, 'a'))),
  };
  const at = node.children.indexOf(contact[0]);
  node.children = node.children.filter((c) => !contact.includes(c));
  node.children.splice(at, 0, group);
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

      if (isElement(node, 'ul') && linksOnly(node)) {
        node.properties.className = [...(node.properties.className ?? []), 'link-list'];
        groupContact(node);
      }

      if (isElement(node, 'ul') && labelled(node)) {
        node.properties.className = [...(node.properties.className ?? []), 'fact-list'];
        for (const li of node.children) if (isElement(li, 'li')) factRow(li);
      }

      if (isElement(node, 'p') && !section) {
        node.properties.className = [...(node.properties.className ?? []), 'page-intro'];
      }

      push(node);
    }

    tree.children = out;

    // A place under a heading of its own gets the card the food places get
    // under theirs, from its hours or prices (its links, with neither) to the
    // links that close it, so every place's links sit inside a card.
    const hasClass = (node, name) => node.properties?.className?.includes(name);
    for (const sec of out) {
      if (!isElement(sec, 'div') || !hasClass(sec, 'section')) continue;
      const kids = sec.children;
      if (kids.some((c) => hasClass(c, 'info-box')) || !kids.some((c) => hasClass(c, 'link-list'))) continue;
      const at = kids.findIndex((c) => hasClass(c, 'fact-list') || hasClass(c, 'link-list'));
      sec.children = [...kids.slice(0, at), div('info-box', kids.slice(at))];
    }

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
