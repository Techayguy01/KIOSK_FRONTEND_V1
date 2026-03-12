
import unittest
import asyncio
from uuid import uuid4
from unittest.mock import patch, MagicMock, AsyncMock
from services.faq_service import find_best_faq_match

class TestSemanticFAQ(unittest.IsolatedAsyncioTestCase):
    async def test_semantic_match_flow(self):
        # Use a valid UUID
        tenant_id = str(uuid4())
        mock_session = MagicMock()
        mock_faq = MagicMock()
        mock_faq.id = uuid4()
        mock_faq.question = "What is the check-in time?"
        mock_faq.answer = "Check-in time is 10:00 AM."
        mock_faq.is_active = True
        
        mock_faq_result = MagicMock()
        mock_faq_result.all.return_value = [mock_faq]
        # Async mock for exec
        mock_session.exec = AsyncMock(return_value=mock_faq_result)
        
        # Mock LLM calls
        with patch("services.faq_service.translate_to_english") as mock_translate, \
             patch("services.faq_service.get_embedding") as mock_embed, \
             patch("services.faq_service.cosine_similarity") as mock_sim, \
             patch("services.faq_service.rephrase_faq_answer") as mock_rephrase:
            
            mock_translate.return_value = "What is the check-in time?"
            mock_embed.return_value = [0.1, 0.2, 0.3]
            mock_sim.return_value = 0.95 # High similarity
            mock_rephrase.return_value = "Our check-in starts at 10:00 AM. How can I help you further?"
            
            result = await find_best_faq_match(mock_session, tenant_id, "Mujhe check-in k baare m batao?")
            
            self.assertIsNotNone(result.match)
            self.assertEqual(result.match.faq_id, str(mock_faq.id))
            self.assertEqual(result.match.match_type, "semantic")
            self.assertEqual(result.match.answer, "Our check-in starts at 10:00 AM. How can I help you further?")
            print(f"✅ Rephrased Match found: {result.match.answer}")

    async def test_semantic_miss_triggers_rejection(self):
        tenant_id = str(uuid4())
        mock_session = MagicMock()
        mock_faq = MagicMock()
        mock_faq.id = uuid4()
        mock_faq.question = "What is the check-in time?"
        mock_faq.answer = "10 AM"
        mock_faq.is_active = True
        
        mock_faq_result = MagicMock()
        mock_faq_result.all.return_value = [mock_faq]
        mock_session.exec = AsyncMock(return_value=mock_faq_result)
        
        with patch("services.faq_service.translate_to_english") as mock_translate, \
             patch("services.faq_service.get_embedding") as mock_embed, \
             patch("services.faq_service.cosine_similarity") as mock_sim, \
             patch("services.faq_service.generate_polite_rejection") as mock_reject:
            
            mock_translate.return_value = "Tell me about your favorite hobby."
            mock_embed.return_value = [0.1]
            mock_sim.return_value = 0.2  # Low similarity
            mock_reject.return_value = "I can only help with hotel related topics."
            
            result = await find_best_faq_match(mock_session, tenant_id, "Tell me about your favorite hobby.")
            
            self.assertIsNotNone(result.match)
            self.assertEqual(result.match.match_type, "rejection")
            self.assertEqual(result.match.answer, "I can only help with hotel related topics.")
            print(f"✅ Polite rejection verified for low score: {result.match.answer}")

    async def test_irrelevant_match(self):
        tenant_id = str(uuid4())
        mock_session = MagicMock()
        
        # We need to mock FAQs because the guard happens before the irrelevant check now.
        mock_faq = MagicMock()
        mock_faq.is_active = True
        mock_faq_result = MagicMock()
        mock_faq_result.all.return_value = [mock_faq]
        mock_session.exec = AsyncMock(return_value=mock_faq_result)
        
        with patch("services.faq_service.translate_to_english") as mock_translate:
            # First query checkin to avoid premature failure on empty faqs if not mocked
            mock_translate.return_value = "What is the weather in Mars?"
            
            result = await find_best_faq_match(mock_session, tenant_id, "What is the weather in Mars?")
            
            self.assertIsNotNone(result.match)
            self.assertEqual(result.match.match_type, "irrelevant")
            print(f"✅ Irrelevant correctly detected after guard: {result.match.answer}")

if __name__ == "__main__":
    unittest.main()
