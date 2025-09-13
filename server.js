import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // serve frontend

// --- Supabase setup ---
const SUPABASE_URL = 'https://oljmrzfgknkqyrwteegi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sam1yemZna25rcXlyd3RlZWdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3NzUxMTQsImV4cCI6MjA3MzM1MTExNH0.ej6megeFZA_L2y57_c-GH--1oz8zixWU6Dw_RTa58r0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- SIGNUP ---
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('profiles').insert([{
      id: data.user.id,
      username,
      money: 10000,
      wins: 0,
      losses: 0,
      biggestWin: 0,
      jackpot: 10000
    }]);

    return res.json({ message: 'Account created successfully' });
  } catch (err) {
    console.log('Signup error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ user: data.user });
  } catch (err) {
    console.log('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- GET PROFILE ---
app.get('/profile/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.log('Profile fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- PLACE BET ---
app.post('/bet/:id', async (req, res) => {
  const { betAmount } = req.body;
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
    if (error) return res.status(400).json({ error: error.message });

    if (betAmount > data.money) return res.status(400).json({ error: 'Insufficient balance' });

    const win = Math.random() < 0.45;
    const multiplier = win ? Math.random() * 3 + 1 : 0;
    const change = win ? Math.floor(betAmount * multiplier) - betAmount : -betAmount;
    let newBiggestWin = data.biggestWin;
    if (win && (change + betAmount > newBiggestWin)) newBiggestWin = change + betAmount;

    const jackpot = data.jackpot + Math.floor(Math.random() * 1000) + 100;

    await supabase.from('profiles').update({
      money: data.money + change,
      wins: data.wins + (win ? 1 : 0),
      losses: data.losses + (!win ? 1 : 0),
      biggestWin: newBiggestWin,
      jackpot
    }).eq('id', req.params.id);

    return res.json({ change, win });
  } catch (err) {
    console.log('Bet error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- Serve frontend ---
app.get('*', (req,res)=>res.sendFile('index.html', { root: 'public' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
