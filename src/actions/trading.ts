"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

export async function getPositions() {
  try {
    const data = await sql`
      SELECT 
        position_id,
        MAX(ticker) as ticker, 
        MAX(platform) as platform, 
        MAX(currency) as currency,
        SUM(CASE WHEN type = 'Buy' THEN quantity ELSE -quantity END) as net_quantity,
        SUM(CASE WHEN type = 'Buy' THEN amount_rm ELSE 0 END) as total_buys_rm,
        SUM(CASE WHEN type = 'Buy' THEN quantity ELSE 0 END) as total_qty_bought,
        SUM(profit_loss) as total_profit
      FROM trading_ledger
      GROUP BY position_id
      ORDER BY MAX(created_at) DESC;
    `;
    
    return data.rows.map((row: any) => {
      const netQty = parseFloat(row.net_quantity || 0);
      const totalBuysRm = parseFloat(row.total_buys_rm || 0);
      const totalQtyBought = parseFloat(row.total_qty_bought || 0);
      
      let netInvested = 0;
      if (netQty > 0 && totalQtyBought > 0) {
        const avgBuyPrice = totalBuysRm / totalQtyBought;
        netInvested = netQty * avgBuyPrice;
      }
      
      return {
        ...row,
        net_invested: netInvested
      };
    });
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch positions.");
  }
}

export async function getTradingLedgerByPosition(positionId: string) {
  try {
    const data = await sql`
      SELECT 
        id, 
        TO_CHAR(date, 'YYYY-MM-DD') as date,
        platform, 
        ticker, 
        type, 
        currency, 
        price, 
        quantity, 
        amount_rm, 
        profit_loss, 
        TO_CHAR(date_closed, 'YYYY-MM-DD') as date_closed
      FROM trading_ledger
      WHERE position_id = ${positionId}
      ORDER BY date DESC, created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch trading ledger for ticker.");
  }
}

export async function getTradingLedger() {
  try {
    const data = await sql`
      SELECT 
        id, 
        TO_CHAR(date, 'YYYY-MM-DD') as date,
        platform, 
        ticker, 
        type, 
        currency, 
        price, 
        quantity, 
        amount_rm, 
        profit_loss, 
        TO_CHAR(date_closed, 'YYYY-MM-DD') as date_closed
      FROM trading_ledger
      ORDER BY date DESC, created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch trading ledger.");
  }
}

export async function addTrade(formData: FormData) {
  let position_id = formData.get("position_id")?.toString();
  const date = formData.get("date")?.toString();
  const platform = formData.get("platform")?.toString();
  const ticker = formData.get("ticker")?.toString()?.toUpperCase();
  const type = formData.get("type")?.toString();
  const currency = formData.get("currency")?.toString()?.toUpperCase();
  const priceStr = formData.get("price")?.toString();
  const quantityStr = formData.get("quantity")?.toString();
  const amountRmStr = formData.get("amount_rm")?.toString();
  const profitLossStr = formData.get("profit_loss")?.toString();
  const dateClosed = formData.get("date_closed")?.toString() || null;

  if (!date || !platform || !ticker || !type || !currency || !priceStr || !quantityStr) {
    return { error: "Missing required fields" };
  }

  if (type === 'Buy' && !amountRmStr) {
    return { error: "RM Amount is required for Buys" };
  }

  const price = parseFloat(priceStr);
  const quantity = parseFloat(quantityStr);
  let amount_rm = parseFloat(amountRmStr || "0");
  const profit_loss = profitLossStr ? parseFloat(profitLossStr) : null;

  if (isNaN(price) || isNaN(quantity) || (type === 'Buy' && isNaN(amount_rm))) {
    return { error: "Numeric fields must be valid numbers" };
  }

  try {
    // Auto-merge logic: If no position_id is provided, check if there is an active position for this ticker.
    if (!position_id) {
      const activePosRes = await sql`
        SELECT position_id
        FROM trading_ledger
        WHERE ticker = ${ticker}
        GROUP BY position_id
        HAVING SUM(CASE WHEN type = 'Buy' THEN quantity ELSE -quantity END) > 0
        LIMIT 1
      `;
      
      if (activePosRes.rows.length > 0) {
        position_id = activePosRes.rows[0].position_id;
      } else {
        position_id = crypto.randomUUID();
      }
    }

    if (type === 'Sell') {
      const qRes = await sql`
        SELECT 
          SUM(CASE WHEN type = 'Buy' THEN quantity ELSE -quantity END) as net_qty,
          SUM(CASE WHEN type = 'Buy' THEN amount_rm ELSE 0 END) as total_buys_rm,
          SUM(CASE WHEN type = 'Buy' THEN quantity ELSE 0 END) as total_qty_bought
        FROM trading_ledger 
        WHERE position_id = ${position_id}
      `;
      const netQty = parseFloat(qRes.rows[0]?.net_qty || 0);
      const totalBuysRm = parseFloat(qRes.rows[0]?.total_buys_rm || 0);
      const totalQtyBought = parseFloat(qRes.rows[0]?.total_qty_bought || 0);

      if (quantity > netQty) {
        return { error: `Insufficient quantity. You only hold ${netQty} units of ${ticker}.` };
      }

      // Auto-calculate amount_rm (Cash Received) for Sells
      const avgBuyPrice = totalQtyBought > 0 ? (totalBuysRm / totalQtyBought) : 0;
      const costBasisOfSharesSold = quantity * avgBuyPrice;
      amount_rm = costBasisOfSharesSold + (profit_loss || 0);
    }

    await sql`
      INSERT INTO trading_ledger (
        position_id, date, platform, ticker, type, currency, price, quantity, amount_rm, profit_loss, date_closed
      ) VALUES (
        ${position_id}, ${date}, ${platform}, ${ticker}, ${type}, ${currency}, ${price}, ${quantity}, ${amount_rm}, ${profit_loss}, ${dateClosed}
      )
    `;
    revalidatePath("/trading");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add trade." };
  }
}

export async function deleteTrade(id: string) {
  try {
    await sql`DELETE FROM trading_ledger WHERE id = ${id}`;
    revalidatePath("/trading");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete trade." };
  }
}

export async function updateTrade(formData: FormData) {
  const id = formData.get("id")?.toString();
  const profitLossStr = formData.get("profit_loss")?.toString();
  const dateClosed = formData.get("date_closed")?.toString() || null;

  if (!id) return { error: "Trade ID is required" };

  const profit_loss = profitLossStr ? parseFloat(profitLossStr) : null;

  try {
    await sql`
      UPDATE trading_ledger
      SET profit_loss = ${profit_loss}, date_closed = ${dateClosed}
      WHERE id = ${id}
    `;
    revalidatePath("/trading");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to update trade." };
  }
}
