// webhook.js - Endpoint para receber notificações de pagamento
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { processarNotificacaoPagamento } = require('./subscription');
const { registrarInteracao } = require('./interactionLog');

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;

// Middleware para parsing do corpo das requisições
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rota para verificação de saúde do serviço
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Webhook service is running' });
});

// Rota para receber notificações do Mercado Pago
app.post('/webhook/mercadopago', async (req, res) => {
    console.log('Recebida notificação do Mercado Pago:', req.body);
    
    try {
        // Validar a notificação
        if (!req.body || !req.body.type || !req.body.data || !req.body.data.id) {
            console.error('Notificação inválida:', req.body);
            return res.status(400).json({ error: 'Invalid notification format' });
        }
        
        // Registrar recebimento da notificação
        await registrarInteracao(
            'SISTEMA',
            'WEBHOOK_RECEBIDO',
            JSON.stringify(req.body),
            'Notificação recebida do Mercado Pago',
            'webhook',
            'RECEBIDO',
            { 
                tipo: req.body.type,
                id: req.body.data.id
            }
        );
        
        // Processar apenas notificações de pagamento ou assinatura
        if (['payment', 'subscription_preapproval'].includes(req.body.type)) {
            // Processar a notificação de forma assíncrona
            processarNotificacaoPagamento(req.body)
                .then(result => {
                    console.log('Notificação processada com sucesso:', result);
                })
                .catch(error => {
                    console.error('Erro ao processar notificação:', error);
                });
        }
        
        // Responder imediatamente para evitar timeout
        res.status(200).json({ status: 'OK', message: 'Notification received' });
    } catch (error) {
        console.error('Erro ao processar webhook:', error);
        
        // Registrar erro
        await registrarInteracao(
            'SISTEMA',
            'WEBHOOK_ERRO',
            JSON.stringify(req.body),
            `Erro: ${error.message}`,
            'webhook',
            'ERRO',
            { erro: error.message }
        );
        
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Rota para receber notificações do PagSeguro (caso decida usar)
app.post('/webhook/pagseguro', async (req, res) => {
    console.log('Recebida notificação do PagSeguro:', req.body);
    
    // Implementação similar ao Mercado Pago, adaptada para o formato do PagSeguro
    res.status(200).json({ status: 'OK', message: 'Notification received' });
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});

module.exports = app; // Para testes