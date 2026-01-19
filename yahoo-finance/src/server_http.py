import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

# Import helper functions from the copied package
# Adjust import based on directory structure: src/yahoo_finance_server
from yahoo_finance_server.helper import (
    get_ticker_info,
    get_ticker_news,
    search_yahoo_finance,
    get_price_history,
    get_top_entities
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("yahoo-finance-http")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Yahoo Finance HTTP Service starting...")
    yield
    logger.info("Yahoo Finance HTTP Service stopping...")

app = FastAPI(title="Yahoo Finance Microservice", lifespan=lifespan)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/ticker/{symbol}")
async def get_info(symbol: str):
    try:
        # get_ticker_info returns a JSON string
        info_json = await get_ticker_info(symbol)
        return json.loads(info_json)
    except Exception as e:
        logger.error(f"Error fetching info for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/news/{symbol}")
async def get_news(symbol: str, count: int = 10):
    try:
        news = await get_ticker_news(symbol, count)
        return news
    except Exception as e:
        logger.error(f"Error fetching news for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
async def search(q: str, count: int = 10):
    try:
        results = await search_yahoo_finance(q, count)
        return results
    except Exception as e:
        logger.error(f"Error searching for {q}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/price-history/{symbol}")
async def price_history(
    symbol: str, 
    period: str = "1y", 
    interval: str = "1d"
):
    try:
        # Valid periods: 1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
        # Valid intervals: 1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo
        history = await get_price_history(symbol, period, interval)
        return history
    except Exception as e:
        logger.error(f"Error fetching price history for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
