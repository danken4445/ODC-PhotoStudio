import os from 'node:os';

export interface PrivateNetworkInterface {
  name: string;
  address: string;
  internal: boolean;
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index]
    )
  ) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function listPrivateIpv4Interfaces(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): PrivateNetworkInterface[] {
  const result: PrivateNetworkInterface[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || !isPrivateIpv4(entry.address)) continue;
      result.push({ name, address: entry.address, internal: entry.internal });
    }
  }
  return result.sort(
    (left, right) =>
      Number(right.internal) - Number(left.internal) ||
      left.name.localeCompare(right.name) ||
      left.address.localeCompare(right.address)
  );
}
