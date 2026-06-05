import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import express from 'express'
import qrcode from 'qrcode-terminal'

const app = express()
app.use(express.json())
const PORT = process.env.PORT || 3000

// Key comes from Railway environment variables - SAFE
const OPENROUTER_KEY = process.env.OPENROUTER_KEY
const YOUR_NUMBER = '09055574518'

const userStates = new Map()

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if(qr) {
            console.log('SCAN THIS QR WITH WHATSAPP:')
            qrcode.generate(qr, {small: true})
        }
        
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode!== DisconnectReason.loggedOut
            if(shouldReconnect) startBot()
        } else if(connection === 'open') {
            console.log('BOT CONNECTED ✅')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if(!msg.message || msg.key.fromMe) return
        
        const sender = msg.key.remoteJid
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
        const phone = sender.split('@')[0]
        
        if(!userStates.has(phone)) {
            userStates.set(phone, { step: 'start', data: {} })
        }
        const user = userStates.get(phone)
        
        if(text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello' || user.step === 'start') {
            await sock.sendMessage(sender, { 
                text: `Welcome to *BREAKTHROUGH COMMAND™* 🔥\n\nI’m your 24/7 AI Strategy Assistant.\n\nTo start, what's your *first name*?` 
            })
            user.step = 'name'
            return
        }
        
        try {
            const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'anthropic/claude-3.5-sonnet',
                    messages: [
                        {
                            role: 'system', 
                            content: 'You are an AI Strategy Assistant for Breakthrough Command. You help users identify their biggest business bottleneck and book strategy calls. Be conversational, sharp, and helpful. Keep responses under 3 lines. Ask qualifying questions.'
                        },
                        {role: 'user', content: text}
                    ]
                })
            })
            
            const data = await aiRes.json()
            const reply = data.choices[0].message.content
            await sock.sendMessage(sender, { text: reply })
            
        } catch(e) {
            await sock.sendMessage(sender, { text: 'I dey think... Try again in 1 min.' })
        }
    })
}

app.post('/tally-webhook', async (req, res) => {
    console.log('Payment received:', req.body)
    res.send('OK')
})

app.get('/', (req, res) => res.send('Breakthrough Bot Running ✅'))
app.listen(PORT, () => console.log(`Server running on ${PORT}`))

startBot()
