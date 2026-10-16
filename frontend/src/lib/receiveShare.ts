import { ARC, TOKENS, isAddress } from './wallet.ts'

type Translate = (value: string) => string

/** Receive sharing only exposes a real public address and the selected network. */
export function createReceiveShareData(address: string, symbol: string, live: boolean, tr: Translate = (value) => value) {
  const full = address.trim()
  if (!live || !isAddress(full) || /^0x0{40}$/i.test(full) || !TOKENS.some((token) => token.sym === symbol)) return null
  const title = tr('Receive {asset} on {network}').replace('{asset}', symbol).replace('{network}', ARC.name)
  const details = [
    title,
    `${tr('Address')}: ${full}`,
    `${tr('Network')}: ${ARC.name}`,
    `${tr('Chain ID')}: ${ARC.chainId}`,
  ].join('\n')
  return {
    address: full, symbol, network: ARC.name, chainId: ARC.chainId, title, details,
    links: {
      x: `https://twitter.com/intent/tweet?${new URLSearchParams({ text: details })}`,
      telegram: `https://t.me/share/url?${new URLSearchParams({ url: 'https://makotowallet.xyz', text: details })}`,
      whatsapp: `https://wa.me/?${new URLSearchParams({ text: details })}`,
    },
    qrFilename: `makoto-receive-${symbol.toLowerCase()}-arc-testnet-${full.toLowerCase()}.svg`,
  }
}

export type ReceiveShareData = NonNullable<ReturnType<typeof createReceiveShareData>>

/** Download the currently rendered address QR, without an external image service. */
export function downloadReceiveQr(svg: SVGSVGElement, data: ReceiveShareData) {
  if (svg.getAttribute('data-receive-address') !== data.address) throw new Error('Receive address changed')
  const image = svg.cloneNode(true) as SVGSVGElement
  image.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const blob = new Blob([new XMLSerializer().serializeToString(image)], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = data.qrFilename
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser consume the download URL before releasing its storage.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
