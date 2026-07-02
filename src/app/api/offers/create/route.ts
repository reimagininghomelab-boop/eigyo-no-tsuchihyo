import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_TIMINGS = ['3ヶ月以内', '半年以内', '1年以内', 'まだ未定'] as const

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  // contact_email はリクエスト本文を使わず認証済みアドレスを使用
  const contact_email = user.email
  if (!contact_email) return NextResponse.json({ error: 'メールアドレスが確認できません' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 })
  }

  const salesperson_id = typeof body.salesperson_id === 'string' ? body.salesperson_id.trim() : ''
  if (!UUID_REGEX.test(salesperson_id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 })
  }

  const trimmedMessage = typeof body.message === 'string' ? body.message.trim() : ''
  const contact_name   = typeof body.contact_name === 'string' ? body.contact_name.trim() : ''

  if (!trimmedMessage || !contact_name) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }
  if (trimmedMessage.length > 200) {
    return NextResponse.json({ error: 'メッセージは200文字以内で入力してください' }, { status: 400 })
  }
  if (contact_name.length > 50) {
    return NextResponse.json({ error: 'お名前は50文字以内で入力してください' }, { status: 400 })
  }

  const rawArea   = typeof body.area === 'string' ? body.area.trim() || null : null
  const rawTiming = typeof body.timing === 'string' ? body.timing.trim() || null : null

  if (rawArea !== null && rawArea.length > 50) {
    return NextResponse.json({ error: '検討エリアは50文字以内で入力してください' }, { status: 400 })
  }
  if (rawTiming !== null && !(VALID_TIMINGS as readonly string[]).includes(rawTiming)) {
    return NextResponse.json({ error: '建築予定時期の値が不正です' }, { status: 400 })
  }

  // 有料開示済み確認（unlocked_profiles.agent_id が salesperson_id に対応）
  const { data: unlocked, error: unlockedError } = await supabase
    .from('unlocked_profiles')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('agent_id', salesperson_id)
    .maybeSingle()
  if (unlockedError) {
    console.error('[offers/create] unlocked_profiles lookup error', { code: unlockedError.code, message: unlockedError.message })
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
  if (!unlocked) return NextResponse.json({ error: 'この営業マンのプロフィールを開示していません' }, { status: 403 })

  // 営業の存在・公開状態確認（status + is_visible 両方チェック）
  const { data: sp, error: spError } = await supabase
    .from('salesperson_profiles')
    .select('id')
    .eq('id', salesperson_id)
    .eq('status', 'active')
    .eq('is_visible', true)
    .maybeSingle()
  if (spError) {
    console.error('[offers/create] salesperson_profiles lookup error', { code: spError.code, message: spError.message })
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
  if (!sp) return NextResponse.json({ error: '営業マンが見つかりません' }, { status: 404 })

  // 重複オファー事前確認
  const { data: existing, error: existingError } = await supabase
    .from('offers')
    .select('id')
    .eq('buyer_id', user.id)
    .eq('salesperson_id', salesperson_id)
    .maybeSingle()
  if (existingError) {
    console.error('[offers/create] duplicate check error', { code: existingError.code, message: existingError.message })
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
  if (existing) return NextResponse.json({ error: 'すでにこの営業マンへオファーを送信済みです' }, { status: 409 })

  const { error } = await supabase.from('offers').insert({
    buyer_id: user.id,
    salesperson_id,
    area:          rawArea,
    timing:        rawTiming,
    message:       trimmedMessage,
    contact_name,
    contact_email,
  })

  if (error) {
    // UNIQUE 制約違反（同時送信の競合）は 409 で返す
    if (error.code === '23505') {
      return NextResponse.json({ error: 'すでにこの営業マンへオファーを送信済みです' }, { status: 409 })
    }
    console.error('[offers/create] insert error', { code: error.code, message: error.message })
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
