import { Fragment, type ReactNode } from 'react'

const T_MUTE = 'text-[#8a8796]'

/**
 * Minimal, safe Markdown subset for Agent replies: paragraphs, "-"/"*"/"1." lists,
 * **bold**, `code`, and [label](https://…) links. Model text is untrusted, so it is
 * rendered only as React text nodes — never as HTML. Links must be https and open
 * in a new tab with noopener/noreferrer.
 */
type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] } | { kind: 'h'; text: string } | { kind: 'table'; rows: string[][] }

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,4}\s+(.*)$/
const TABLE_ROW = /^\s*\|(.+)\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function parseAgentMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const last = blocks[blocks.length - 1]
    if (!line.trim()) { blocks.push({ kind: 'p', lines: [] }); continue }
    const row = line.match(TABLE_ROW)
    if (row) {
      if (TABLE_RULE.test(line)) continue
      const cells = row[1].split('|').map((cell) => cell.trim())
      if (last?.kind === 'table') last.rows.push(cells); else blocks.push({ kind: 'table', rows: [cells] })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) { blocks.push({ kind: 'h', text: heading[1] }); continue }
    const bullet = line.match(BULLET)
    if (bullet) { if (last?.kind === 'ul') last.items.push(bullet[1]); else blocks.push({ kind: 'ul', items: [bullet[1]] }); continue }
    const numbered = line.match(NUMBERED)
    if (numbered) { if (last?.kind === 'ol') last.items.push(numbered[1]); else blocks.push({ kind: 'ol', items: [numbered[1]] }); continue }
    if (last?.kind === 'p') last.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
  }
  return blocks.filter((block) => block.kind !== 'p' || block.lines.length > 0)
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]{1,200}\]\((https:\/\/[^\s)]{1,500})\))/g

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let index = 0
  let match: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((match = INLINE.exec(text))) {
    if (match.index > index) out.push(text.slice(index, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('**')) out.push(<strong key={key} className="font-semibold text-white">{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) out.push(<code key={key} className="px-1 rounded bg-white/[0.06] font-mono text-[12.5px]">{token.slice(1, -1)}</code>)
    else {
      const label = token.slice(1, token.indexOf(']('))
      out.push(<a key={key} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-neon-300 underline decoration-neon-300/40 hover:decoration-neon-300 [overflow-wrap:anywhere]">{label}</a>)
    }
    index = match.index + token.length
  }
  if (index < text.length) out.push(text.slice(index))
  return out
}

export function AgentMarkdown({ text }: { text: string }) {
  const blocks = parseAgentMarkdown(text)
  return (
    <div className="space-y-2 [overflow-wrap:anywhere]">
      {blocks.map((block, blockIndex) => {
        if (block.kind === 'table') {
          const [head, ...body] = block.rows
          return (
            <div key={blockIndex} className="overflow-x-auto rounded-lg border border-white/[0.07]">
              <table className="w-full text-[12.5px]">
                <thead><tr>{head.map((cell, i) => <th key={i} className={`px-2.5 py-1.5 text-left font-semibold ${T_MUTE}`}>{renderInline(cell, `th${blockIndex}-${i}`)}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[0.05]">{body.map((cells, r) => <tr key={r}>{cells.map((cell, i) => <td key={i} className="px-2.5 py-1.5 font-num">{renderInline(cell, `td${blockIndex}-${r}-${i}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'h') return <p key={blockIndex} className="font-semibold text-white">{renderInline(block.text, `h${blockIndex}`)}</p>
        if (block.kind === 'p') return <p key={blockIndex}>{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, `p${blockIndex}-${lineIndex}`)}</Fragment>)}</p>
        const List = block.kind === 'ul' ? 'ul' : 'ol'
        return (
          <List key={blockIndex} className={`${block.kind === 'ul' ? 'list-disc' : 'list-decimal'} pl-5 space-y-1 marker:text-neon-300/70`}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `l${blockIndex}-${itemIndex}`)}</li>)}
          </List>
        )
      })}
    </div>
  )
}
