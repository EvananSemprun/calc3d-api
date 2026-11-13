-- Tercer estado de una ficha: «solo pedido especial» (se cotiza y se compra, pero
-- no se repone ni se cuenta).
--
-- ADITIVA: agregar un valor a un enum de Postgres no toca ninguna fila.

ALTER TYPE "MaterialStatus" ADD VALUE 'SOLO_PEDIDO_ESPECIAL';
