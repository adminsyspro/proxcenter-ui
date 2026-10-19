import { describe, it, expect } from "vitest"
import { parseGuestStaticIpv4 } from "./soap"

// guest.net + guest.ipStack of a Windows Server 2022 with a static IPv4, as
// vCenter 8 answered them (lab, 19/10/2026).
const W22 = "<objects><obj type=\"VirtualMachine\">vm-20468</obj><propSet><name>guest.ipStack</name><val xsi:type=\"ArrayOfGuestStackInfo\"><GuestStackInfo xsi:type=\"GuestStackInfo\"><dnsConfig><dhcp>false</dhcp><hostName>W22-I1000</hostName><domainName></domainName><ipAddress>1.1.1.1</ipAddress></dnsConfig><ipRouteConfig><ipRoute><network>0.0.0.0</network><prefixLength>0</prefixLength><gateway><ipAddress>10.42.0.1</ipAddress><device>0</device></gateway></ipRoute><ipRoute><network>10.42.0.0</network><prefixLength>24</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>10.42.0.239</network><prefixLength>32</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>10.42.0.255</network><prefixLength>32</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>224.0.0.0</network><prefixLength>4</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>255.255.255.255</network><prefixLength>32</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>fe80::</network><prefixLength>64</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>fe80::1c50:e58e:22cb:9c60</network><prefixLength>128</prefixLength><gateway><device>0</device></gateway></ipRoute><ipRoute><network>ff00::</network><prefixLength>8</prefixLength><gateway><device>0</device></gateway></ipRoute></ipRouteConfig></GuestStackInfo></val></propSet><propSet><name>guest.net</name><val xsi:type=\"ArrayOfGuestNicInfo\"><GuestNicInfo xsi:type=\"GuestNicInfo\"><network>VM Network</network><ipAddress>fe80::1c50:e58e:22cb:9c60</ipAddress><ipAddress>10.42.0.239</ipAddress><macAddress>00:50:56:9c:a1:f0</macAddress><connected>true</connected><deviceConfigId>4000</deviceConfigId><dnsConfig><dhcp>false</dhcp><hostName></hostName><domainName></domainName><ipAddress>1.1.1.1</ipAddress></dnsConfig><ipConfig><ipAddress><ipAddress>fe80::1c50:e58e:22cb:9c60</ipAddress><prefixLength>64</prefixLength><origin>linklayer</origin><state>unknown</state></ipAddress><ipAddress><ipAddress>10.42.0.239</ipAddress><prefixLength>24</prefixLength><origin>manual</origin><state>preferred</state></ipAddress><dhcp><ipv6><enable>false</enable></ipv6><ipv4><enable>false</enable></ipv4></dhcp></ipConfig></GuestNicInfo></val></propSet></objects>"

describe("parseGuestStaticIpv4 (#1000 follow-up)", () => {
  it("reads the static IPv4, its gateway and DNS from a real vCenter answer", () => {
    expect(parseGuestStaticIpv4(W22)).toEqual([
      { mac: "00:50:56:9c:a1:f0", address: "10.42.0.239", prefixLength: 24, gateway: "10.42.0.1", dns: ["1.1.1.1"], extraAddresses: 0 },
    ])
  })

  it("leaves out a NIC on DHCP, and one without a manual IPv4", () => {
    expect(parseGuestStaticIpv4(W22.replace("<ipv4><enable>false</enable></ipv4>", "<ipv4><enable>true</enable></ipv4>"))).toEqual([])
    expect(parseGuestStaticIpv4(W22.replace("<origin>manual</origin>", "<origin>dhcp</origin>"))).toEqual([])
    expect(parseGuestStaticIpv4("")).toEqual([])
  })

  it("takes the gateway of the NIC's own default route, the stack DNS as a fallback, and counts extra addresses", () => {
    const second = '<GuestNicInfo xsi:type="GuestNicInfo"><macAddress>00:50:56:9c:a1:f1</macAddress><ipConfig>'
      + '<ipAddress><ipAddress>192.168.5.10</ipAddress><prefixLength>16</prefixLength><origin>manual</origin><state>preferred</state></ipAddress>'
      + '<ipAddress><ipAddress>192.168.5.11</ipAddress><prefixLength>16</prefixLength><origin>manual</origin><state>preferred</state></ipAddress>'
      + '<dhcp><ipv4><enable>false</enable></ipv4></dhcp></ipConfig></GuestNicInfo>'
    const xml = W22.replace("</GuestNicInfo></val>", `</GuestNicInfo>${second}</val>`)
    expect(parseGuestStaticIpv4(xml)[1]).toEqual({ mac: "00:50:56:9c:a1:f1", address: "192.168.5.10", prefixLength: 16, dns: ["1.1.1.1"], extraAddresses: 1 })
  })
})
