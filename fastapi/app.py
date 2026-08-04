"""Entry point for running the API locally:  python app.py"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=2728, reload=False)
