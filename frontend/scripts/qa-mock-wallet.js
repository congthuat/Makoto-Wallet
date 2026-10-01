/* Isolated browser QA fixture. It never broadcasts a transaction. */
(() => {
  const account = '0x1111111111111111111111111111111111111111'
  const hex = (value) => BigInt(value).toString(16).padStart(64, '0')
  const encodedSymbol = (symbol) => `0x${hex(32)}${hex(symbol.length)}${Array.from(symbol).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')}`
  const emitter = new Map()
  window.ethereum = {
    isMetaMask: true,
    on: (event, handler) => { emitter.set(event, handler) },
    removeListener: (event) => { emitter.delete(event) },
    request: async ({ method, params = [] }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      if (method === 'eth_chainId') return '0x4cef52'
      if (method === 'eth_blockNumber') return '0x100'
      if (method === 'eth_getBalance') return '0x1000000000000000'
      if (method === 'eth_getCode') return '0x6000'
      if (method === 'eth_gasPrice') return '0x3b9aca00'
      if (method === 'eth_estimateGas') return '0x186a0'
      if (method === 'eth_getTransactionReceipt') return null
      if (method === 'eth_call') {
        const { to = '', data = '' } = params[0] || {}
        if (data === '0x313ce567') return to.toLowerCase() === '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf' ? '0x8' : '0x6'
        if (data === '0x95d89b41') return encodedSymbol(to.toLowerCase() === '0x89b50855aa3be2f677cd6303cec089b5f319d72a' ? 'EURC' : to.toLowerCase() === '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf' ? 'cirBTC' : 'USDC')
        if (data.startsWith('0x70a08231')) return `0x${hex(10000000)}`
        if (data.startsWith('0xdd62ed3e')) return `0x${hex(2000000)}`
        return `0x${hex(990000)}`
      }
      if (method === 'eth_sendTransaction') throw Object.assign(new Error('QA mock blocks all submissions'), { code: 4001 })
      throw new Error(`Mock RPC method unavailable: ${method}`)
    },
  }
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = String(input)
    if (url.includes('/api/cctp/fees')) return Promise.resolve(new Response(JSON.stringify({ finalityThreshold: 2000, minimumFee: 0, forwardFeeMed: '57543', quotedAt: Date.now() }), { status: 200, headers: { 'content-type': 'application/json' } }))
    return nativeFetch(input, init)
  }
})()
