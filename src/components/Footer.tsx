'use client'
import Link from 'next/link'

const FOOTER_SECTIONS = [
  {
    title: 'サービス',
    links: [
      { label: '担当者をさがす', href: '/search' },
    ],
  },
  {
    title: 'ご利用案内',
    links: [
      { label: '営業担当者の方へ', href: '/for-salespeople' },
    ],
  },
  {
    title: '運営・法務',
    links: [
      { label: '利用規約', href: '/terms' },
      { label: 'プライバシーポリシー', href: '/privacy' },
      { label: '特定商取引法に基づく表記', href: '/commercial-transactions' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="bg-[#f5f7f8] border-t border-stone-200">
      <div className="max-w-4xl mx-auto px-6 py-10 md:py-12">
        {/* サービス説明 */}
        <div className="mb-8">
          <p className="text-sm font-bold text-[#488a99] mb-2 tracking-wide">ERABERU</p>
          <p className="text-[11px] text-[#7a8385] leading-relaxed max-w-md">
            エラベルは、住宅会社の担当者との出会いを通じて、家づくりの不安を減らすサービスです。
          </p>
        </div>

        {/* リンク一覧 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="text-xs font-bold text-[#96a0a2] mb-3 tracking-wider uppercase">
                {section.title}
              </p>
              <ul className="space-y-1">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[#2d3436] hover:text-[#488a99] focus-visible:text-[#488a99] focus-visible:outline-none focus-visible:underline transition-colors py-2 block"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* コピーライト */}
        <div className="border-t border-stone-200 pt-6">
          <p className="text-xs text-[#96a0a2]">
            © {new Date().getFullYear()} エラベル
          </p>
        </div>
      </div>
    </footer>
  )
}
