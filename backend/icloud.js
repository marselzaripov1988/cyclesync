import { parseStringPromise } from "xml2js";

const CARDDAV_URL = "https://contacts.icloud.com";

function makeAuthHeader(appleId, appSpecificPassword) {
  return `Basic ${Buffer.from(`${appleId}:${appSpecificPassword}`).toString("base64")}`;
}

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([A-F0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseVCards(vcf) {
  const entries = vcf.split(/END:VCARD/i);
  const names = [];
  for (const entry of entries) {
    const card = entry.trim();
    if (!card) continue;

    let name = "";
    const fn = card.match(/(?:^|\n)FN(?:;[^:\n]*)?:(.+)/i);
    if (fn?.[1]) {
      name = fn[1];
      if (/ENCODING=QUOTED-PRINTABLE/i.test(fn[0])) {
        name = decodeQuotedPrintable(name);
      }
      name = name.replace(/\\,/g, ",").trim();
    }
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

async function requestPrincipal(authHeader) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal />
  </D:prop>
</D:propfind>`;

  const response = await fetch(`${CARDDAV_URL}/`, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader,
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Could not authenticate with iCloud CardDAV.");
  }

  const xml = await response.text();
  const parsed = await parseStringPromise(xml);
  const href =
    parsed?.["D:multistatus"]?.["D:response"]?.[0]?.["D:propstat"]?.[0]?.["D:prop"]?.[0]?.[
      "D:current-user-principal"
    ]?.[0]?.["D:href"]?.[0];
  return href;
}

async function requestAddressBookHome(authHeader, principalPath) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <C:addressbook-home-set />
  </D:prop>
</D:propfind>`;

  const response = await fetch(`${CARDDAV_URL}${principalPath}`, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader,
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  if (!response.ok) throw new Error("Could not locate iCloud address books.");

  const xml = await response.text();
  const parsed = await parseStringPromise(xml);
  const href =
    parsed?.["D:multistatus"]?.["D:response"]?.[0]?.["D:propstat"]?.[0]?.["D:prop"]?.[0]?.[
      "C:addressbook-home-set"
    ]?.[0]?.["D:href"]?.[0];
  return href;
}

async function requestAddressBooks(authHeader, homePath) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:displayname />
    <D:resourcetype />
  </D:prop>
</D:propfind>`;

  const response = await fetch(`${CARDDAV_URL}${homePath}`, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  if (!response.ok) throw new Error("Could not read iCloud address book list.");

  const xml = await response.text();
  const parsed = await parseStringPromise(xml);
  const responses = parsed?.["D:multistatus"]?.["D:response"] || [];
  for (const item of responses) {
    const href = item?.["D:href"]?.[0];
    const resourceType = item?.["D:propstat"]?.[0]?.["D:prop"]?.[0]?.["D:resourcetype"]?.[0] || {};
    if (resourceType["C:addressbook"]) {
      return href;
    }
  }
  throw new Error("No iCloud address book found.");
}

async function requestVcf(authHeader, addressBookPath) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag />
    <C:address-data />
  </D:prop>
</C:addressbook-query>`;

  const response = await fetch(`${CARDDAV_URL}${addressBookPath}`, {
    method: "REPORT",
    headers: {
      Authorization: authHeader,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  if (!response.ok) throw new Error("Could not fetch iCloud contacts.");

  const xml = await response.text();
  const parsed = await parseStringPromise(xml);
  const responses = parsed?.["D:multistatus"]?.["D:response"] || [];
  const vcards = [];
  for (const item of responses) {
    const card =
      item?.["D:propstat"]?.[0]?.["D:prop"]?.[0]?.["C:address-data"]?.[0] ||
      item?.["D:propstat"]?.[0]?.["D:prop"]?.[0]?.["address-data"]?.[0];
    if (typeof card === "string" && card.includes("BEGIN:VCARD")) {
      vcards.push(card);
    }
  }
  return vcards.join("\n");
}

export async function syncICloudContacts(appleId, appSpecificPassword) {
  const authHeader = makeAuthHeader(appleId, appSpecificPassword);
  const principalPath = await requestPrincipal(authHeader);
  const homePath = await requestAddressBookHome(authHeader, principalPath);
  const addressBookPath = await requestAddressBooks(authHeader, homePath);
  const vcf = await requestVcf(authHeader, addressBookPath);
  return parseVCards(vcf);
}

