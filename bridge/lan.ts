/**
 * Which address should the controller dial?
 *
 * The pairing page used to prefill the bridge URL from `window.location.hostname` — whatever
 * address the operator happened to type into the browser. On a machine with more than one IPv4
 * that is a trap: opening the page on `https://192.168.64.1:5173` (macOS' VM bridge, Docker's
 * `docker0`, a VPN tunnel) writes an address into the controller's flash that exists only on the
 * station machine. The M5 then joins the WiFi, gets an address on the *real* LAN, and dials into
 * nothing — `tcpProbeOk:false`, forever, with no hint as to why.
 *
 * So the bridge names its own reachable addresses and the page offers them. Virtual interfaces
 * stay in the list — sometimes they are the right answer — but they sort last, never first.
 */
import { networkInterfaces } from "node:os";

export interface LanHost {
  /** IPv4 address the controller would dial. */
  readonly address: string;
  /** Interface it belongs to, shown in the picker so an operator can tell them apart. */
  readonly iface: string;
  /** False for VM bridges, container bridges and tunnels — reachable from the LAN is unlikely. */
  readonly physical: boolean;
}

/**
 * Interfaces that exist for virtual machines, containers or tunnels. A controller on the WiFi
 * cannot route to them, but a container-hosted bridge might legitimately live there — hence
 * ranked down rather than dropped.
 */
const VIRTUAL_IFACE =
  /^(bridge|vmenet|vnic|utun|ipsec|tap|tun|docker|br-|virbr|veth|vboxnet|anpi|awdl|llw)/i;

/** IPv4 addresses of this machine, physical interfaces first, each family in a stable order. */
export function listLanHosts(): readonly LanHost[] {
  const hosts: LanHost[] = [];

  for (const [iface, addresses] of Object.entries(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      // Node <18.4 reports `family` as a string, newer ones as a number; accept both.
      const isIpv4 = entry.family === "IPv4" || (entry.family as unknown as number) === 4;
      if (!isIpv4 || entry.internal || entry.address.startsWith("169.254.")) {
        continue;
      }
      hosts.push({ address: entry.address, iface, physical: !VIRTUAL_IFACE.test(iface) });
    }
  }

  return hosts.sort((left, right) => {
    if (left.physical !== right.physical) {
      return left.physical ? -1 : 1;
    }
    return left.iface.localeCompare(right.iface) || left.address.localeCompare(right.address);
  });
}
