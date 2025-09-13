import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SUPABASE_URL = 'https://oljmrzfgknkqyrwteegi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sam1yemZna25rcXlyd3RlZWdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3NzUxMTQsImV4cCI6MjA3MzM1MTExNH0.ej6megeFZA_L2y57_c-GH--1oz8zixWU6Dw_RTa58r0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- SIGNUP ---
app.post('/signup', async (req, res) => {
    const { email, password, username } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('profiles').insert([{ id: data.user.id, username, money: 10000, wins:0, losses:0 }]);
    res.json({ message: 'Account created' });
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data.user });
});

// --- GET PROFILE ---
app.get('/profile/:id', async (req, res) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
});

// --- PLACE BET ---
app.post('/bet/:id', async (req, res) => {
    const { gameType, betAmount } = req.body;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.params.id).single();
    if (error) return res.status(400).json({ error: error.message });

    let currentMoney = data.money;
    if (betAmount > currentMoney) return res.status(400).json({ error: 'Insufficient balance' });

    const win = Math.random() < 0.45;
    const multiplier = win ? Math.random() * 3 + 1 : 0;
    const change = win ? Math.floor(betAmount * multiplier) - betAmount : -betAmount;

    const updated = await supabase.from('profiles')
        .update({ money: currentMoney + change, wins: data.wins + (win?1:0), losses: data.losses + (!win?1:0) })
        .eq('id', req.params.id);
    
    res.json({ change, win });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
