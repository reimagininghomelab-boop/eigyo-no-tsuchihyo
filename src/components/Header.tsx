'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

const ADMIN_EMAILS = ['reimagining.home.lab@gmail.com', '1989yo55@gmail.com']

type UserType = 'anon' | 'buyer' | 'salesperson' | 'admin'

export default function Header({ backButton = false }: { backButton?: boolean }) {
  const [userType, setUserType] = useState<UserType | null>(null) // null = 認証状態確認中
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const supabase = createClient()
    let active = true
    let detectionId = 0

    const detectFromSession = async (session: Session | null) => {
      const currentId = ++detectionId

      const updateUserType = (nextType: UserType) => {
        if (!active || currentId !== detectionId) return
        setUserType(nextType)
      }

      const user = session?.user ?? null
      if (!user) { updateUserType('anon'); return }
      if (ADMIN_EMAILS.includes(user.email ?? '')) { updateUserType('admin'); return }

      try {
        const result = await Promise.race([
          supabase
            .from('salesperson_profiles')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              reject(new Error('salesperson profile lookup timed out'))
            }, 5000)
          }),
        ])

        if (result.error) {
          throw result.error
        }
        updateUserType(result.data ? 'salesperson' : 'buyer')
      } catch (error) {
        console.error('Failed to detect user type:', error)
        updateUserType('anon')
      }
    }

    const initialize = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        await detectFromSession(session)
      } catch (error) {
        console.error('Failed to get session:', error)
        if (active) setUserType('anon')
      }
    }

    void initialize()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void detectFromSession(session)
    })
    return () => {
      active = false
      detectionId += 1
      subscription.unsubscribe()
    }
  }, [])

  const handleSignOut = async () => {
    try {
      await createClient().auth.signOut({ scope: 'local' })
    } catch (error) {
      console.error('Sign out failed:', error)
    }
    window.location.href = '/'
  }

  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 md:px-6">

        {/* PC */}
        <div className="hidden md:flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              {backButton && (
                <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition text-sm">
                  ← 戻る
                </button>
              )}
              <Link href="/" className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-teal-600 tracking-tight">ERABERU</span>
                <span className="text-xs text-gray-400 hidden lg:block">注文住宅の担当者選び</span>
              </Link>
            </div>
            {(userType === 'anon' || userType === 'buyer') && (
              <nav className="flex items-center gap-0.5">
                <Link href="/search" className="text-sm text-gray-600 hover:text-teal-600 px-3 py-1.5 rounded-lg hover:bg-teal-50 transition">
                  担当者をさがす
                </Link>
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            {userType === 'anon' && (
              pathname === '/for-salespeople' ? (
                <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 transition hidden lg:block">
                  TOPへ戻る
                </Link>
              ) : (
                <Link href="/for-salespeople" className="text-xs text-gray-400 hover:text-gray-600 transition hidden lg:block">
                  営業マンとして登録
                </Link>
              )
            )}
            {userType === 'admin' && (
              <>
                <Link href="/admin" className="text-xs text-orange-500 hover:text-orange-400 font-medium transition">管理画面</Link>
                <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600 transition">ログアウト</button>
              </>
            )}
            {userType === 'salesperson' && (
              <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600 transition">ログアウト</button>
            )}
            {userType === 'buyer' && (
              <>
                <Link href="/mypage" className="text-sm text-gray-700 hover:text-teal-600 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-teal-200 transition">
                  相談・口コミ管理
                </Link>
                <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600 transition">ログアウト</button>
              </>
            )}
            {userType === 'anon' && (
              <Link href="/auth/login" className="text-sm text-teal-600 hover:text-teal-500 font-semibold px-4 py-1.5 rounded-lg border border-teal-200 hover:bg-teal-50 transition">
                ログイン
              </Link>
            )}
            {userType === null && (
              <span className="w-16 h-5 bg-stone-100 rounded animate-pulse inline-block" />
            )}
          </div>
        </div>

        {/* モバイル */}
        <div className="md:hidden">
          <div className="flex items-center justify-between h-12">
            <div className="flex items-center gap-2">
              {backButton && (
                <button onClick={() => router.back()} className="text-gray-400 text-sm">← 戻る</button>
              )}
              <Link href="/">
                <span className="text-lg font-black text-teal-600 tracking-tight">ERABERU</span>
              </Link>
            </div>
            <div className="flex items-center gap-2">
              {userType === 'admin' && (
                <>
                  <Link href="/admin" className="text-xs text-orange-500 font-medium">管理</Link>
                  <button onClick={handleSignOut} className="text-xs text-gray-400">ログアウト</button>
                </>
              )}
              {userType === 'salesperson' && (
                <button onClick={handleSignOut} className="text-xs text-gray-400">ログアウト</button>
              )}
              {userType === 'buyer' && (
                <>
                  <Link href="/mypage" className="text-xs text-gray-600 border border-stone-200 px-2.5 py-1 rounded-lg">
                    相談・口コミ
                  </Link>
                  <button onClick={handleSignOut} className="text-xs text-gray-400">ログアウト</button>
                </>
              )}
              {userType === 'anon' && (
                <Link href="/auth/login" className="text-xs text-teal-600 font-semibold px-3 py-1 rounded-lg border border-teal-200 bg-teal-50">
                  ログイン
                </Link>
              )}
              {userType === null && (
                <span className="w-16 h-5 bg-stone-100 rounded animate-pulse inline-block" />
              )}
            </div>
          </div>
          {(userType === 'anon' || userType === 'buyer') && (
            <div className="flex items-center gap-0 pb-2 -mx-1 overflow-x-auto">
              <Link href="/search" className="text-xs text-gray-600 whitespace-nowrap px-3 py-1 rounded-lg hover:bg-stone-100 transition">
                担当者をさがす
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
