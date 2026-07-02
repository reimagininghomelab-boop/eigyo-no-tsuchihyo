import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      }
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
  const token = authHeader.slice(7)

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  )
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const { salesperson_id } = await req.json()

    if (!salesperson_id) {
      return new Response(JSON.stringify({ error: 'salesperson_id is required' }), { status: 400 })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: 'price_1TJaCs2NjGKceYcpO5dp3nS2',
        quantity: 1,
      }],
      mode: 'payment',
      client_reference_id: user.id,
      metadata: { salesperson_id },
      success_url: `${req.headers.get('origin')}/salesperson/${salesperson_id}?payment=success`,
      cancel_url: `${req.headers.get('origin')}/salesperson/${salesperson_id}?payment=cancelled`,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }
})
